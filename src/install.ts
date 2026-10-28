import type { BrowserContext, Frame, Page, Request, Response } from '@playwright/test';

import { splitByBaseline } from './baseline.js';
import { type Allowance, createContext } from './context.js';
import { evaluate } from './evaluate.js';
import { formatFindings } from './format.js';
import { checkAllow, resolveOptions } from './options.js';
import { guardInPage, type PageOptions } from './page-script.js';
import { readInitial, takeSnapshot } from './snapshot.js';
import type {
  Allow,
  Finding,
  Observation,
  PageEvent,
  PrivacyGuardOptions,
  StateSnapshot,
} from './types.js';
import { parseUrl } from './urls.js';

/** Everything the guard found, as it is attached to the test (privacy-report.json). */
export interface PrivacyReport {
  version: 1;
  generatedAt: string;
  mode: 'enforce' | 'report';
  /** What is not in the baseline: the findings that count */
  findings: Finding[];
  /** What the baseline file knows and accepts */
  known: Finding[];
  counts: { errors: number; warnings: number };
  /** The paths of the pages the guard saw */
  pages: string[];
  observations: number;
  /** Observations that were not kept because `maxObservations` was reached */
  dropped: number;
}

/** The guard of one test: what it found so far, and how to talk to it. */
export interface PrivacyGuard {
  /**
   * What was found so far in the requests, writes and messages the guard has seen. The state at the
   * end (cookies, storage) is added by `check()`.
   */
  readonly findings: readonly Finding[];
  /** Looks at everything, including the cookies and the storage the browser holds now */
  check: () => Promise<Finding[]>;
  /** Throws an error that names every problem (that is an error) when there is one */
  assertClean: () => Promise<void>;
  /**
   * Allows more from now on (the page may talk to a consent provider after the visitor accepted).
   * Requests that were made earlier are still judged by what was allowed then.
   */
  allow: (allow: Allow) => void;
  /** Forgets everything seen so far and counts what the browser holds now as known */
  forget: () => Promise<void>;
  /** The report, with the state of the browser now */
  report: () => Promise<PrivacyReport>;
}

let counter = 0;

interface Source {
  page: Page;
  frame: Frame;
}

/** The page and frame of a request, which a service worker request does not have. */
function placeOf(request: Request): { page: Page; frame: Frame } | undefined {
  try {
    const frame = request.frame();
    return { frame, page: frame.page() };
  } catch {
    return undefined;
  }
}

/**
 * Starts the guard for every page of a browser context. Call it before the page is opened: the part
 * that runs in the page is added as an init script. The fixture of this package does that for you;
 * use this when you build your own.
 */
export async function installPrivacyGuard(
  context: BrowserContext,
  options: PrivacyGuardOptions = {},
  baseURL?: string,
): Promise<PrivacyGuard> {
  counter += 1;
  const resolved = resolveOptions(options);
  const baseOrigin = baseURL === undefined ? undefined : parseUrl(baseURL)?.origin;
  const started = Date.now();
  const now = (): number => Date.now() - started;
  const observations: Observation[] = [];
  const allowances: Allowance[] = [];
  const pending = new Set<Promise<void>>();
  let dropped = 0;
  let initial = await readInitial(context);
  let lastSnapshot: StateSnapshot | undefined;
  // The address of each page as the test navigated it: the origin that counts as the page's own
  const current = new WeakMap<Page, string>();
  // Pages are numbered, and the ones that another page opened are remembered (see away.ts)
  const numbers = new WeakMap<Page, number>();
  const popups = new Set<number>();
  let nextNumber = 0;
  // Requests whose page was not known yet (the first request of a new tab), asked again later
  const unplaced: { observation: Observation; request: Request }[] = [];
  const watching = resolved.watch.length > 0;

  const numberOf = (page: Page): number => {
    let number = numbers.get(page);
    if (number === undefined) {
      nextNumber += 1;
      number = nextNumber;
      numbers.set(page, number);
    }
    return number;
  };

  /** The fields that say which page an observation belongs to */
  const whereIs = (page: Page | undefined): { page: string; pageId?: number } =>
    page === undefined ? { page: pageUrl(page) } : { page: pageUrl(page), pageId: numberOf(page) };

  const pageUrl = (page: Page | undefined): string => {
    if (page === undefined) {
      return baseURL ?? '';
    }
    return current.get(page) ?? (page.isClosed() ? '' : page.url());
  };

  const add = (observation: Observation): void => {
    if (observations.length >= resolved.maxObservations) {
      dropped += 1;
      return;
    }
    observations.push(observation);
  };

  /** Playwright calls these handlers without waiting: an error in one must not become a crash */
  const safely =
    <A extends unknown[]>(handler: (...args: A) => void) =>
    (...args: A): void => {
      try {
        handler(...args);
      } catch {
        // A browser that is closing may take its objects away in the middle of a handler
      }
    };

  context.on(
    'request',
    safely((request: Request) => {
      const place = placeOf(request);
      const top = place?.frame.parentFrame() === null ? place : undefined;
      // The first request of a new tab is made before its frame exists: that is a navigation too
      const navigation =
        request.isNavigationRequest() && (top !== undefined || place === undefined);
      if (top !== undefined && request.isNavigationRequest()) {
        current.set(top.page, request.url());
      }
      const origin = parseUrl(request.url())?.origin;
      const crossOrigin = origin !== undefined && origin !== parseUrl(pageUrl(place?.page))?.origin;
      const body =
        watching && crossOrigin ? (request.postData() ?? undefined)?.slice(0, 20_000) : undefined;
      const observation: Extract<Observation, { kind: 'request' }> = {
        kind: 'request',
        at: now(),
        ...whereIs(place?.page),
        frame: place?.frame.url() ?? '',
        url: request.url(),
        method: request.method(),
        resourceType: request.serviceWorker() === null ? request.resourceType() : 'service-worker',
        navigation,
        ...(body === undefined ? {} : { body }),
      };
      add(observation);
      if (place === undefined) {
        unplaced.push({ observation, request });
      }
      if (crossOrigin) {
        // The headers of a request are complete only when Playwright is asked for all of them
        const reading = request
          .allHeaders()
          .then((headers) => {
            if (headers.referer !== undefined) {
              observation.referer = headers.referer;
            }
          })
          .catch(() => undefined)
          .finally(() => pending.delete(reading));
        pending.add(reading);
      }
    }),
  );

  context.on(
    'response',
    safely((response: Response) => {
      const request = response.request();
      const place = placeOf(request);
      const navigation = request.isNavigationRequest() && place?.frame.parentFrame() === null;
      const observation: Extract<Observation, { kind: 'response' }> = {
        kind: 'response',
        at: now(),
        ...whereIs(place?.page),
        frame: place?.frame.url() ?? '',
        url: response.url(),
        status: response.status(),
        navigation,
        setCookies: [],
        headers: {},
      };
      add(observation);
      if (place === undefined) {
        unplaced.push({ observation, request });
      }
      // The headers come in a second step; check() waits for them
      const reading = response
        .headersArray()
        .then((headers) => {
          observation.setCookies = headers
            .filter((header) => header.name.toLowerCase() === 'set-cookie')
            .flatMap((header) => header.value.split('\n'));
          if (request.isNavigationRequest()) {
            const map: Record<string, string> = {};
            for (const header of headers) {
              const name = header.name.toLowerCase();
              map[name] = name in map ? `${map[name] ?? ''}, ${header.value}` : header.value;
            }
            observation.headers = map;
          }
        })
        .catch(() => undefined)
        .finally(() => pending.delete(reading));
      pending.add(reading);
    }),
  );

  context.on(
    'requestfailed',
    safely((request: Request) => {
      const place = placeOf(request);
      add({
        kind: 'request-failed',
        at: now(),
        ...whereIs(place?.page),
        frame: place?.frame.url() ?? '',
        url: request.url(),
        error: request.failure()?.errorText ?? 'failed',
      });
    }),
  );

  context.on(
    'console',
    safely((message) => {
      const page = message.page();
      const location = message.location();
      add({
        kind: 'console',
        at: now(),
        ...whereIs(page ?? undefined),
        frame: '',
        type: message.type(),
        text: message.text(),
        location: location.url === '' ? '' : `${location.url}:${String(location.lineNumber + 1)}`,
      });
    }),
  );

  const attach = (page: Page): void => {
    page.on(
      'pageerror',
      safely((error: Error) => {
        add({
          kind: 'page-error',
          at: now(),
          ...whereIs(page),
          frame: '',
          message: error.message,
          stack: error.stack ?? '',
        });
      }),
    );
    page.on(
      'websocket',
      safely((socket) => {
        add({
          kind: 'request',
          at: now(),
          ...whereIs(page),
          frame: page.url(),
          url: socket.url(),
          method: 'GET',
          resourceType: 'websocket',
          navigation: false,
        });
      }),
    );
  };
  /** A page that another page opened is a popup: asking is asynchronous, check() waits for it */
  const watchOpener = (page: Page): void => {
    const reading = page
      .opener()
      .then((opener) => {
        if (opener !== null) {
          popups.add(numberOf(page));
        }
      })
      .catch(() => undefined)
      .finally(() => pending.delete(reading));
    pending.add(reading);
  };
  context.on('page', (page) => {
    attach(page);
    watchOpener(page);
  });
  for (const page of context.pages()) {
    attach(page);
  }

  const report = `__privacyGuard${String(counter)}`;
  await context.exposeBinding(report, (source: Source, event: PageEvent) => {
    add({
      kind: 'page',
      at: now(),
      ...whereIs(source.page),
      frame: source.frame.url(),
      event,
    });
  });
  const forPage: PageOptions = {
    report,
    apis: resolved.levels.apis !== 'off',
    fingerprint: resolved.levels.fingerprint !== 'off',
    storage: resolved.levels.cookies !== 'off' || resolved.levels.storage !== 'off',
    dom:
      resolved.levels.headers !== 'off' ||
      resolved.levels.cspQuality !== 'off' ||
      resolved.levels.requests !== 'off' ||
      resolved.levels.forms !== 'off' ||
      resolved.levels.sri !== 'off',
  };
  await context.addInitScript(guardInPage, forPage);

  /** By now the frame of a new tab exists: say which page those first requests belonged to */
  const placeTheUnplaced = (): void => {
    for (let index = unplaced.length - 1; index >= 0; index -= 1) {
      const entry = unplaced[index];
      const place = entry === undefined ? undefined : placeOf(entry.request);
      if (entry !== undefined && place !== undefined) {
        Object.assign(entry.observation, whereIs(place.page), { frame: place.frame.url() });
        unplaced.splice(index, 1);
      }
    }
  };

  const judge = (snapshot: StateSnapshot | undefined): Finding[] => {
    placeTheUnplaced();
    const seen =
      popups.size === 0
        ? observations
        : observations.map((observation) =>
            observation.pageId !== undefined && popups.has(observation.pageId)
              ? { ...observation, popup: true }
              : observation,
          );
    return evaluate(seen, snapshot, createContext(resolved, baseOrigin, allowances));
  };

  const check = async (): Promise<Finding[]> => {
    await Promise.all([...pending]);
    lastSnapshot = await takeSnapshot(context, initial);
    return judge(lastSnapshot);
  };

  return {
    get findings() {
      return judge(lastSnapshot);
    },
    check,
    assertClean: async () => {
      const { fresh } = splitByBaseline(await check(), resolved.baseline);
      if (resolved.mode === 'enforce' && fresh.some((found) => found.level === 'error')) {
        throw new Error(formatFindings(fresh));
      }
    },
    allow: (allow) => {
      allowances.push({ at: now(), allow: checkAllow(allow, 'allow()') });
    },
    forget: async () => {
      await Promise.all([...pending]);
      observations.length = 0;
      dropped = 0;
      initial = await takeSnapshot(context, initial).then((snapshot) => ({
        cookies: snapshot.cookies,
        localStorage: snapshot.storage.flatMap((entry) =>
          entry.localStorage.map((name) => ({
            origin: parseUrl(entry.frame)?.origin ?? entry.frame,
            name,
            value: '',
          })),
        ),
      }));
      lastSnapshot = undefined;
    },
    report: async () => {
      const all = await check();
      const { fresh: findings, known } = splitByBaseline(all, resolved.baseline);
      const errors = findings.filter((found) => found.level === 'error').length;
      return {
        version: 1,
        generatedAt: new Date().toISOString(),
        mode: resolved.mode,
        findings,
        known,
        counts: { errors, warnings: findings.length - errors },
        pages: [...new Set(all.map((found) => found.page))],
        observations: observations.length,
        dropped,
      };
    },
  };
}
