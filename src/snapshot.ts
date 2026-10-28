import type { BrowserContext, Frame } from '@playwright/test';

import { isNetworkUrl, parseUrl } from './urls.js';
import type { CookieState, StateSnapshot } from './types.js';

type StorageEntry = StateSnapshot['storage'][number];

/**
 * Runs in the page (Playwright sends it as text): what the page holds on the device. Every part is
 * tried alone, because a browser can refuse one of them (storage blocked, no `databases()`).
 */
async function readStorage(): Promise<Omit<StorageEntry, 'frame' | 'page'>> {
  const keys = (storage: () => Storage | undefined): string[] => {
    try {
      const area = storage();
      return area === undefined ? [] : Object.keys(area);
    } catch {
      return [];
    }
  };
  const list = async (read: () => Promise<string[]>): Promise<string[]> => {
    try {
      return await read();
    } catch {
      return [];
    }
  };
  return {
    localStorage: keys(() => window.localStorage),
    sessionStorage: keys(() => window.sessionStorage),
    indexedDB: await list(async () =>
      (await indexedDB.databases())
        .map((database) => database.name ?? '')
        .filter((name) => name !== ''),
    ),
    cacheStorage: await list(() => caches.keys()),
    serviceWorkers: await list(async () =>
      (await navigator.serviceWorker.getRegistrations()).map(
        (registration) =>
          (registration.active ?? registration.waiting ?? registration.installing)?.scriptURL ??
          registration.scope,
      ),
    ),
  };
}

const toState = (cookie: Awaited<ReturnType<BrowserContext['cookies']>>[number]): CookieState => ({
  name: cookie.name,
  domain: cookie.domain,
  path: cookie.path,
  value: cookie.value,
  expires: cookie.expires,
  httpOnly: cookie.httpOnly,
  secure: cookie.secure,
  sameSite: cookie.sameSite,
});

/** What was in the browser before the test started (a login from `storageState`). */
export async function readInitial(context: BrowserContext): Promise<StateSnapshot['initial']> {
  try {
    const state = await context.storageState();
    return {
      cookies: state.cookies.map(toState),
      localStorage: state.origins.flatMap((origin) =>
        origin.localStorage.map((item) => ({
          origin: origin.origin,
          name: item.name,
          value: item.value,
        })),
      ),
    };
  } catch {
    return { cookies: [], localStorage: [] };
  }
}

/** The value of a promise, or undefined when it takes longer than the time allows */
async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((done) => {
        timer = setTimeout(() => {
          done(undefined);
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function readFrame(frame: Frame): Promise<StorageEntry | undefined> {
  const parsed = parseUrl(frame.url());
  if (parsed === undefined || !isNetworkUrl(parsed) || frame.isDetached()) {
    return undefined;
  }
  try {
    // A frame that never answers (a page stuck in a dialog) must not hold the test at its end
    const stored = await withTimeout(frame.evaluate(readStorage), 5000);
    if (stored === undefined) {
      return undefined;
    }
    return { frame: frame.url(), page: frame.page().mainFrame().url(), ...stored };
  } catch {
    // A frame that is gone, a page that is closing or an origin that blocks storage
    return undefined;
  }
}

/** Looks at the cookies of the context and at the storage of every frame of every open page. */
export async function takeSnapshot(
  context: BrowserContext,
  initial: StateSnapshot['initial'],
): Promise<StateSnapshot> {
  const cookies = (await context.cookies()).map(toState);
  const frames = context
    .pages()
    .filter((page) => !page.isClosed())
    .flatMap((page) => page.frames());
  const storage = (await Promise.all(frames.map(readFrame))).filter(
    (entry): entry is StorageEntry => entry !== undefined,
  );
  return { cookies, storage, initial };
}
