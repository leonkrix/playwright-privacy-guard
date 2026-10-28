import type { Context } from './context.js';
import { matchesName, matchesText, matchesUrl } from './match.js';
import { describeSource, firstFrame, sourceOf } from './stack.js';
import { trackerOf } from './trackers.js';
import type {
  ApiName,
  CookieState,
  Finding,
  Observation,
  PageEvent,
  RuleId,
  Source,
  StateSnapshot,
} from './types.js';
import { checkPolicy, parsePolicy, type PolicyIssue } from './csp.js';
import { checkHeaders, type HeaderIssue } from './headers.js';
import { isLocalHost, isNetworkUrl, parseUrl, pathOf } from './urls.js';

type Request = Extract<Observation, { kind: 'request' }>;
type Response = Extract<Observation, { kind: 'response' }>;
type FromPage<K extends PageEvent['kind']> = Observation & {
  kind: 'page';
  event: Extract<PageEvent, { kind: K }>;
};

/** The observations of one kind of page event, in order. */
function pageEvents<K extends PageEvent['kind']>(
  observations: readonly Observation[],
  kind: K,
): FromPage<K>[] {
  return observations.filter(
    (observation): observation is FromPage<K> =>
      observation.kind === 'page' && observation.event.kind === kind,
  );
}

function group<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    const list = groups.get(name);
    if (list === undefined) {
      groups.set(name, [item]);
    } else {
      list.push(item);
    }
  }
  return groups;
}

/** `script x2, image x1` */
function countBy(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => (count === 1 ? value : `${value} x${String(count)}`))
    .join(', ');
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

function cut(text: string, length = 240): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > length ? `${single.slice(0, length - 3)}...` : single;
}

function finding(
  context: Context,
  rule: RuleId,
  fields: Omit<Finding, 'rule' | 'level' | 'count'> & { count?: number },
): Finding[] {
  const level = context.level(rule);
  if (level === 'off') {
    return [];
  }
  return [{ rule, level, count: 1, ...fields }];
}

// -------------------------------------------------------------------------------------------------
// requests, insecure

/** A request to the network that does not belong to the page. */
function thirdPartyRequests(observations: readonly Observation[], context: Context): Request[] {
  return observations.filter((observation): observation is Request => {
    if (observation.kind !== 'request' || observation.navigation) {
      return false;
    }
    const address = parseUrl(observation.url);
    return (
      address !== undefined &&
      isNetworkUrl(address) &&
      !context.isFirstParty(address, observation.page)
    );
  });
}

export function requestsRule(observations: readonly Observation[], context: Context): Finding[] {
  if (context.level('requests') === 'off') {
    return [];
  }
  interface Item {
    host: string;
    what: string;
    address: string;
    page: string;
    at: number;
    frame: string;
  }
  const items: Item[] = [];
  for (const request of thirdPartyRequests(observations, context)) {
    const address = parseUrl(request.url);
    if (address === undefined) {
      continue;
    }
    const allowed = context.allowAt(request.at).requests;
    if (allowed.some((entry) => matchesUrl(entry, address))) {
      continue;
    }
    items.push({
      host: address.host,
      what: request.resourceType,
      address: request.url,
      page: request.page,
      at: request.at,
      frame: request.frame,
    });
  }
  for (const event of pageEvents(observations, 'hint')) {
    const address = parseUrl(event.event.href);
    if (
      address === undefined ||
      !isNetworkUrl(address) ||
      context.isFirstParty(address, event.page) ||
      context.allowAt(event.at).requests.some((entry) => matchesUrl(entry, address))
    ) {
      continue;
    }
    items.push({
      host: address.host,
      what: `link rel=${event.event.rel}`,
      address: event.event.href,
      page: event.page,
      at: event.at,
      frame: event.frame,
    });
  }
  return [...group(items, (item) => item.host).entries()].flatMap(([host, list]) => {
    const first = list[0];
    if (first === undefined) {
      return [];
    }
    const tracker = trackerOf(host.replace(/:\d+$/, ''));
    const source: Source = { frame: first.frame, resourceType: first.what };
    const hintsOnly = list.every((item) => item.what.startsWith('link rel='));
    return finding(context, 'requests', {
      subject: host,
      summary: hintsOnly
        ? `the page tells the browser to connect to ${host} (${plural(list.length, 'hint')})`
        : `${plural(list.length, 'request')} to ${host}`,
      details: [
        `kinds: ${countBy(list.map((item) => item.what))}`,
        `first: ${context.show(first.address)}`,
        ...(first.frame === '' ? [] : [`from: ${context.show(first.frame)}`]),
      ],
      count: list.length,
      page: pathOf(first.page),
      source,
      ...(tracker === undefined ? {} : { tracker }),
      allow: { key: 'requests', value: host },
      at: first.at,
    });
  });
}

export function insecureRule(observations: readonly Observation[], context: Context): Finding[] {
  if (context.level('insecure') === 'off') {
    return [];
  }
  const items = observations.flatMap((observation) => {
    if (observation.kind !== 'request' || observation.navigation) {
      return [];
    }
    const address = parseUrl(observation.url);
    if (
      address === undefined ||
      !['http:', 'ws:'].includes(address.protocol) ||
      isLocalHost(address.hostname) ||
      context.allowAt(observation.at).insecure.some((entry) => matchesUrl(entry, address))
    ) {
      return [];
    }
    return [{ host: address.host, observation }];
  });
  return [...group(items, (item) => item.host).entries()].flatMap(([host, list]) => {
    const first = list[0]?.observation;
    if (first === undefined) {
      return [];
    }
    return finding(context, 'insecure', {
      subject: host,
      summary: `${plural(list.length, 'request')} to ${host} without encryption (http or ws)`,
      details: [`first: ${context.show(first.url)}`],
      count: list.length,
      page: pathOf(first.page),
      allow: { key: 'insecure', value: host },
      at: first.at,
    });
  });
}

// -------------------------------------------------------------------------------------------------
// cookies

interface SetCookie {
  name: string;
  attributes: Map<string, string>;
  gone: boolean;
}

/** A `Set-Cookie` header: the name, the attributes, and whether it deletes the cookie. */
export function parseSetCookie(header: string): SetCookie | undefined {
  const [pair = '', ...rest] = header.split(';');
  const equals = pair.indexOf('=');
  const name = (equals === -1 ? pair : pair.slice(0, equals)).trim();
  if (name === '') {
    return undefined;
  }
  const attributes = new Map<string, string>();
  for (const part of rest) {
    const at = part.indexOf('=');
    const key = (at === -1 ? part : part.slice(0, at)).trim().toLowerCase();
    if (key !== '') {
      attributes.set(key, at === -1 ? '' : part.slice(at + 1).trim());
    }
  }
  const maxAge = attributes.get('max-age');
  const expires = attributes.get('expires');
  const gone =
    (maxAge !== undefined && Number(maxAge) <= 0) ||
    (expires !== undefined && Date.parse(expires) < Date.now());
  return { name, attributes, gone };
}

function describeCookie(cookie: CookieState): string[] {
  const lifetime =
    cookie.expires === -1
      ? 'ends with the session'
      : `expires in ${String(Math.max(0, Math.round((cookie.expires * 1000 - Date.now()) / 86_400_000)))} days`;
  const flags = [
    cookie.secure ? 'Secure' : 'not Secure',
    cookie.httpOnly ? 'HttpOnly' : 'readable by scripts',
    `SameSite=${cookie.sameSite}`,
  ];
  return [`stored for ${cookie.domain}${cookie.path}: ${lifetime}`, flags.join(', ')];
}

export function cookiesRule(
  observations: readonly Observation[],
  snapshot: StateSnapshot | undefined,
  context: Context,
): Finding[] {
  if (context.level('cookies') === 'off') {
    return [];
  }
  const allowed = context.allowAt(Number.POSITIVE_INFINITY).cookies;
  interface Seen {
    name: string;
    how: string;
    where: string;
    page: string;
    at: number;
    source?: Source;
    kept?: CookieState;
  }
  const seen: Seen[] = [];
  for (const observation of observations) {
    if (observation.kind === 'response') {
      for (const header of observation.setCookies) {
        const cookie = parseSetCookie(header);
        if (cookie !== undefined && !cookie.gone) {
          const host = parseUrl(observation.url)?.host ?? observation.url;
          seen.push({
            name: cookie.name,
            how: `Set-Cookie header of a response from ${host}`,
            where: context.show(observation.url),
            page: observation.page,
            at: observation.at,
            source: { url: observation.url },
          });
        }
      }
    } else if (observation.kind === 'page' && observation.event.kind === 'cookie-write') {
      const source = sourceOf(observation.event.stack, observation.event.script);
      seen.push({
        name: observation.event.name,
        how: `${observation.event.via} in a script`,
        where: describeSource(source) ?? observation.frame,
        page: observation.page,
        at: observation.at,
        ...(source === undefined ? {} : { source }),
      });
    }
  }
  const initial = snapshot?.initial.cookies ?? [];
  const kept = (snapshot?.cookies ?? []).filter(
    (cookie) =>
      !initial.some(
        (before) =>
          before.name === cookie.name &&
          before.domain === cookie.domain &&
          before.path === cookie.path &&
          before.value === cookie.value,
      ),
  );
  const names = new Set<string>([
    ...seen.map((item) => item.name),
    ...kept.map((cookie) => cookie.name),
  ]);
  const findings: Finding[] = [];
  for (const name of names) {
    if (allowed.some((entry) => matchesName(entry, name))) {
      continue;
    }
    const events = seen.filter((item) => item.name === name);
    const states = kept.filter((cookie) => cookie.name === name);
    const first = events[0];
    const page = first?.page ?? snapshot?.storage[0]?.page ?? '';
    const domain = states[0]?.domain.replace(/^\./, '') ?? parseUrl(first?.where ?? '')?.hostname;
    const tracker = domain === undefined ? undefined : trackerOf(domain);
    const stored =
      states.length > 0
        ? states.flatMap((cookie) => describeCookie(cookie))
        : ['the browser did not keep it (rejected or already removed)'];
    findings.push(
      ...finding(context, 'cookies', {
        subject: `cookie ${name}`,
        summary:
          events.length > 0
            ? `cookie "${name}" is set by the page`
            : `cookie "${name}" is in the browser`,
        details: [
          ...events.slice(0, 3).map((item) => `set by: ${item.how} (${item.where})`),
          ...stored,
        ],
        count: Math.max(1, events.length),
        page: pathOf(page),
        ...(first?.source === undefined ? {} : { source: first.source }),
        ...(tracker === undefined ? {} : { tracker }),
        allow: { key: 'cookies', value: name },
        at: first?.at ?? 0,
      }),
    );
  }
  return findings;
}

// -------------------------------------------------------------------------------------------------
// storage

const AREA_TITLES = {
  localStorage: 'localStorage',
  sessionStorage: 'sessionStorage',
  indexedDB: 'IndexedDB database',
  cacheStorage: 'Cache Storage cache',
  serviceWorker: 'service worker',
} as const;

type Area = keyof typeof AREA_TITLES;

export function storageRule(
  observations: readonly Observation[],
  snapshot: StateSnapshot | undefined,
  context: Context,
): Finding[] {
  if (context.level('storage') === 'off') {
    return [];
  }
  const allowedAt = context.allowAt(Number.POSITIVE_INFINITY);
  interface Seen {
    area: Area;
    key: string;
    origin: string;
    how: string;
    page: string;
    at: number;
    source?: Source;
  }
  const seen: Seen[] = [];
  for (const event of pageEvents(observations, 'storage-write')) {
    const source = sourceOf(event.event.stack, event.event.script);
    seen.push({
      area: event.event.area,
      key: event.event.key,
      origin: parseUrl(event.frame)?.origin ?? event.frame,
      how:
        source === undefined ? 'written by a script' : `written by ${describeSource(source) ?? ''}`,
      page: event.page,
      at: event.at,
      ...(source === undefined ? {} : { source }),
    });
  }
  const initialKeys = new Set(
    (snapshot?.initial.localStorage ?? []).map((item) => `${item.origin} ${item.name}`),
  );
  for (const entry of snapshot?.storage ?? []) {
    const origin = parseUrl(entry.frame)?.origin ?? entry.frame;
    const state: [Area, string[]][] = [
      ['localStorage', entry.localStorage],
      ['sessionStorage', entry.sessionStorage],
      ['indexedDB', entry.indexedDB],
      ['cacheStorage', entry.cacheStorage],
      ['serviceWorker', entry.serviceWorkers],
    ];
    for (const [area, keys] of state) {
      for (const key of keys) {
        if (area === 'localStorage' && initialKeys.has(`${origin} ${key}`)) {
          continue;
        }
        seen.push({
          area,
          key,
          origin,
          how: 'found in the browser at the end of the test',
          page: entry.page,
          at: 0,
        });
      }
    }
  }
  const allowedEntries = (area: Area) => (area === 'serviceWorker' ? [] : allowedAt[area]);
  const findings: Finding[] = [];
  for (const [id, list] of group(seen, (item) => `${item.area} ${item.origin} ${item.key}`)) {
    const first = list[0];
    if (first === undefined || id === '') {
      continue;
    }
    if (first.area === 'serviceWorker' && allowedAt.serviceWorkers) {
      continue;
    }
    if (allowedEntries(first.area).some((entry) => matchesName(entry, first.key))) {
      continue;
    }
    const written = list.find((item) => item.source !== undefined) ?? first;
    const tracker = trackerOf(parseUrl(first.origin)?.hostname ?? '');
    findings.push(
      ...finding(context, 'storage', {
        subject: `${AREA_TITLES[first.area]} "${first.key}"`,
        summary: `the page stores "${first.key}" in ${AREA_TITLES[first.area]}`,
        details: [
          `origin: ${first.origin}`,
          ...[...new Set(list.map((item) => item.how))].slice(0, 3),
        ],
        count: list.length,
        page: pathOf(written.page),
        ...(written.source === undefined ? {} : { source: written.source }),
        ...(tracker === undefined ? {} : { tracker }),
        allow:
          first.area === 'serviceWorker'
            ? { key: 'serviceWorkers', value: 'true' }
            : { key: first.area, value: first.key },
        at: written.at,
      }),
    );
  }
  return findings;
}

// -------------------------------------------------------------------------------------------------
// csp

export function cspRule(observations: readonly Observation[], context: Context): Finding[] {
  if (context.level('csp') === 'off') {
    return [];
  }
  const events = pageEvents(observations, 'csp').filter((observation) => {
    const text = `${observation.event.directive} ${observation.event.blocked}`;
    return !context.allowAt(observation.at).csp.some((entry) => matchesText(entry, text));
  });
  return [
    ...group(events, (item) => `${item.event.directive} ${item.event.blocked}`).entries(),
  ].flatMap(([, list]) => {
    const first = list[0];
    if (first === undefined) {
      return [];
    }
    const { event } = first;
    const where =
      event.sourceFile === ''
        ? undefined
        : `${event.sourceFile}:${String(event.line)}:${String(event.column)}`;
    return finding(context, 'csp', {
      subject: `${event.directive}: ${event.blocked === '' ? 'inline' : event.blocked}`,
      summary: `the policy ${event.disposition === 'report' ? 'would block' : 'blocked'} ${event.blocked === '' ? 'an inline resource' : event.blocked} (${event.directive})`,
      details: [
        ...(where === undefined ? [] : [`from: ${context.show(where)}`]),
        ...(event.sample === '' ? [] : [`sample: ${cut(event.sample, 120)}`]),
        ...(event.disposition === 'report'
          ? ['the policy only reports (Content-Security-Policy-Report-Only)']
          : []),
      ],
      count: list.length,
      page: pathOf(first.page),
      allow: { key: 'csp', value: `${event.directive} ${event.blocked}`.trim() },
      at: first.at,
    });
  });
}

// -------------------------------------------------------------------------------------------------
// errors

const ABORTED = /ERR_ABORTED|NS_BINDING_ABORTED|cancel+ed|aborted/i;

export function errorsRule(observations: readonly Observation[], context: Context): Finding[] {
  if (context.level('errors') === 'off') {
    return [];
  }
  interface Item {
    text: string;
    subject: string;
    detail: string[];
    observation: Observation;
  }
  const cspCovered = context.level('csp') !== 'off';
  const items: Item[] = [];
  for (const observation of observations) {
    if (observation.kind === 'console' && observation.type === 'error') {
      // The network errors are reported below with their address, and the browser repeats a
      // policy violation as a console error that the csp rule has already reported
      if (/^Failed to load resource/i.test(observation.text)) {
        continue;
      }
      if (cspCovered && /Content[- ]Security[- ]Policy|^Refused to /i.test(observation.text)) {
        continue;
      }
      items.push({
        text: observation.text,
        subject: 'console error',
        detail: observation.location === '' ? [] : [`at: ${context.show(observation.location)}`],
        observation,
      });
    } else if (observation.kind === 'page-error') {
      const place = describeSource(firstFrame(observation.stack));
      items.push({
        text: observation.message,
        subject: 'uncaught exception',
        detail: place === undefined ? [] : [`at: ${context.show(place)}`],
        observation,
      });
    } else if (
      observation.kind === 'request-failed' &&
      !ABORTED.test(observation.error) &&
      // A request that the policy blocked is reported by the csp rule
      !(cspCovered && /csp/i.test(observation.error))
    ) {
      items.push({
        text: `${observation.error} ${observation.url}`,
        subject: 'failed request',
        detail: [`address: ${context.show(observation.url)}`],
        observation,
      });
    } else if (observation.kind === 'response' && observation.status >= 400) {
      items.push({
        text: `${String(observation.status)} ${observation.url}`,
        subject: `HTTP ${String(observation.status)}`,
        detail: [`address: ${context.show(observation.url)}`],
        observation,
      });
    }
  }
  return [...group(items, (item) => `${item.subject} ${item.text}`).entries()].flatMap(
    ([, list]) => {
      const first = list[0];
      if (first === undefined) {
        return [];
      }
      const allowed = context.allowAt(first.observation.at).errors;
      if (allowed.some((entry) => matchesText(entry, first.text))) {
        return [];
      }
      return finding(context, 'errors', {
        subject: first.subject,
        summary: cut(first.text),
        details: first.detail,
        count: list.length,
        page: pathOf(first.observation.page),
        allow: { key: 'errors', value: first.text },
        at: first.observation.at,
      });
    },
  );
}

// -------------------------------------------------------------------------------------------------
// apis

const API_TITLES: Record<ApiName, string> = {
  geolocation: 'the location of the visitor',
  'camera-or-microphone': 'the camera or the microphone',
  'screen-capture': 'a recording of the screen',
  notifications: 'permission to show notifications',
  webrtc: 'a WebRTC connection (can show the IP address)',
  'clipboard-read': 'the clipboard',
  midi: 'MIDI devices',
  bluetooth: 'Bluetooth devices',
  usb: 'USB devices',
  serial: 'serial ports',
  hid: 'HID devices',
};

export function apisRule(observations: readonly Observation[], context: Context): Finding[] {
  if (context.level('apis') === 'off') {
    return [];
  }
  const events = pageEvents(observations, 'api').filter(
    (observation) => !context.allowAt(observation.at).apis.includes(observation.event.api),
  );
  return [...group(events, (item) => item.event.api).entries()].flatMap(([api, list]) => {
    const first = list[0];
    if (first === undefined) {
      return [];
    }
    const source = sourceOf(first.event.stack, first.event.script);
    return finding(context, 'apis', {
      subject: `API ${api}`,
      summary: `the page asks for ${API_TITLES[first.event.api]}`,
      details: [
        ...(source === undefined ? [] : [`from: ${context.show(describeSource(source) ?? '')}`]),
      ],
      count: list.length,
      page: pathOf(first.page),
      ...(source === undefined ? {} : { source }),
      allow: { key: 'apis', value: api },
      at: first.at,
    });
  });
}

// -------------------------------------------------------------------------------------------------
// fingerprint

const FINGERPRINT_TITLES = {
  canvas: 'pixels read back from a canvas (the image differs a little from browser to browser)',
  webgl: 'the name of the graphics card',
  audio: 'audio that is rendered and read (the result differs a little from device to device)',
  battery: 'the battery state',
  fonts: 'many font checks (which fonts are installed?)',
} as const;

export function fingerprintRule(observations: readonly Observation[], context: Context): Finding[] {
  if (context.level('fingerprint') === 'off') {
    return [];
  }
  const events = pageEvents(observations, 'fingerprint').filter(
    (observation) =>
      !context.allowAt(observation.at).fingerprint.includes(observation.event.technique),
  );
  return [...group(events, (item) => item.event.technique).entries()].flatMap(([name, list]) => {
    const first = list[0];
    if (first === undefined) {
      return [];
    }
    const source = sourceOf(first.event.stack, first.event.script);
    return finding(context, 'fingerprint', {
      subject: `fingerprinting: ${name}`,
      summary: `a script reads ${FINGERPRINT_TITLES[first.event.technique]}`,
      details: [
        `how: ${countBy(list.map((item) => item.event.detail))}`,
        ...(source === undefined ? [] : [`from: ${context.show(describeSource(source) ?? '')}`]),
        'a game or an editor that draws on a canvas does this legitimately: allow it with allow.fingerprint',
      ],
      count: list.length,
      page: pathOf(first.page),
      ...(source === undefined ? {} : { source }),
      allow: { key: 'fingerprint', value: name },
      at: first.at,
    });
  });
}

// -------------------------------------------------------------------------------------------------
// forms

export function formsRule(observations: readonly Observation[], context: Context): Finding[] {
  if (context.level('forms') === 'off') {
    return [];
  }
  interface Item {
    address: string;
    what: string;
    host: string;
    observation: Observation;
  }
  const items: Item[] = [];
  for (const observation of observations) {
    if (observation.kind !== 'page') {
      continue;
    }
    const { event } = observation;
    const [address, what] =
      event.kind === 'form'
        ? [event.action, `form (${event.method})`]
        : event.kind === 'ping'
          ? [event.href, 'link with a ping attribute']
          : [undefined, ''];
    const parsed = address === undefined ? undefined : parseUrl(address);
    if (
      address === undefined ||
      parsed === undefined ||
      !isNetworkUrl(parsed) ||
      context.isFirstParty(parsed, observation.page) ||
      context.allowAt(observation.at).requests.some((entry) => matchesUrl(entry, parsed))
    ) {
      continue;
    }
    items.push({ address, what, host: parsed.host, observation });
  }
  return [...group(items, (item) => `${item.what} ${item.host}`).entries()].flatMap(([, list]) => {
    const first = list[0];
    if (first === undefined) {
      return [];
    }
    return finding(context, 'forms', {
      subject: `${first.what} to ${first.host}`,
      summary: `a ${first.what} sends data to ${first.host}`,
      details: [`address: ${context.show(first.address)}`],
      count: list.length,
      page: pathOf(first.observation.page),
      allow: { key: 'requests', value: first.host },
      at: first.observation.at,
    });
  });
}

// -------------------------------------------------------------------------------------------------
// referrer, sri, leaks

export function referrerRule(observations: readonly Observation[], context: Context): Finding[] {
  if (context.level('referrer') === 'off') {
    return [];
  }
  const items = thirdPartyRequests(observations, context).flatMap((request) => {
    const address = parseUrl(request.url);
    const referer = request.referer === undefined ? undefined : parseUrl(request.referer);
    if (address === undefined || referer === undefined) {
      return [];
    }
    // Only a third party that the test allowed: the others are reported by the requests rule
    if (!context.allowAt(request.at).requests.some((entry) => matchesUrl(entry, address))) {
      return [];
    }
    const revealing = referer.pathname !== '/' || referer.search !== '';
    return revealing ? [{ host: address.host, request, referer }] : [];
  });
  return [...group(items, (item) => item.host).entries()].flatMap(([host, list]) => {
    const first = list[0];
    if (first === undefined) {
      return [];
    }
    return finding(context, 'referrer', {
      subject: host,
      summary: `${host} receives the full address of the page as referrer`,
      details: [
        `referer: ${context.show(first.referer.href)}`,
        'a Referrer-Policy such as strict-origin-when-cross-origin sends only the origin',
      ],
      count: list.length,
      page: pathOf(first.request.page),
      at: first.request.at,
    });
  });
}

export function sriRule(observations: readonly Observation[], context: Context): Finding[] {
  if (context.level('sri') === 'off') {
    return [];
  }
  const events = pageEvents(observations, 'asset').filter((observation) => {
    const address = parseUrl(observation.event.href);
    if (address === undefined || observation.event.integrity) {
      return false;
    }
    const allowed = context.allowAt(observation.at);
    return (
      !context.isFirstParty(address, observation.page) &&
      allowed.requests.some((entry) => matchesUrl(entry, address)) &&
      !allowed.integrity.some((entry) => matchesUrl(entry, address))
    );
  });
  return [...group(events, (item) => item.event.href).entries()].flatMap(([href, list]) => {
    const first = list[0];
    if (first === undefined) {
      return [];
    }
    const host = parseUrl(href)?.host ?? href;
    return finding(context, 'sri', {
      subject: `${first.event.tag === 'script' ? 'script' : 'stylesheet'} from ${host}`,
      summary: `a ${first.event.tag === 'script' ? 'script' : 'stylesheet'} from ${host} has no integrity attribute`,
      details: [
        `address: ${context.show(href)}`,
        'with integrity="sha384-..." the browser refuses a file that was changed',
      ],
      count: list.length,
      page: pathOf(first.page),
      allow: { key: 'integrity', value: href },
      at: first.at,
    });
  });
}

function mask(value: string): string {
  return value.length <= 4
    ? '****'
    : `${value.slice(0, 2)}${'*'.repeat(Math.min(value.length - 4, 8))}${value.slice(-2)}`;
}

export function leaksRule(observations: readonly Observation[], context: Context): Finding[] {
  const watched = context.options.watch;
  if (context.level('leaks') === 'off' || watched.length === 0) {
    return [];
  }
  interface Hit {
    label: string;
    host: string;
    where: string;
    request: Request;
  }
  const hits: Hit[] = [];
  for (const request of thirdPartyRequests(observations, context)) {
    const address = parseUrl(request.url);
    if (address === undefined) {
      continue;
    }
    let decoded = request.url;
    try {
      decoded = decodeURIComponent(request.url);
    } catch {
      // a broken escape: the raw text is searched
    }
    const places: [string, string][] = [
      ['the address', `${request.url}\n${decoded}`],
      ['the body', request.body ?? ''],
      ['the referer header', request.referer ?? ''],
    ];
    for (const value of watched) {
      const label = typeof value === 'string' ? value : String(value);
      for (const [where, text] of places) {
        const found =
          typeof value === 'string'
            ? text.toLowerCase().includes(value.toLowerCase())
            : ((value.lastIndex = 0), value.test(text));
        if (found) {
          hits.push({ label, host: address.host, where, request });
        }
      }
    }
  }
  return [...group(hits, (hit) => `${hit.host} ${hit.label}`).entries()].flatMap(([, list]) => {
    const first = list[0];
    if (first === undefined) {
      return [];
    }
    const shown = context.options.redact ? mask(first.label) : first.label;
    const leakTracker = trackerOf(first.host.replace(/:\d+$/, ''));
    return finding(context, 'leaks', {
      subject: `${shown} to ${first.host}`,
      summary: `the value "${shown}" was sent to ${first.host}`,
      details: [
        `found in: ${[...new Set(list.map((hit) => hit.where))].join(', ')}`,
        `request: ${context.show(first.request.url)}`,
      ],
      count: list.length,
      page: pathOf(first.request.page),
      ...(leakTracker === undefined ? {} : { tracker: leakTracker }),
      at: first.request.at,
    });
  });
}

// -------------------------------------------------------------------------------------------------
// headers, cspQuality

interface Document {
  response: Response;
  address: URL;
}

/** The documents of the page's own origin whose headers were seen (no redirects). */
function ownDocuments(observations: readonly Observation[], context: Context): Document[] {
  return observations.flatMap((observation) => {
    if (
      observation.kind !== 'response' ||
      Object.keys(observation.headers).length === 0 ||
      (observation.status >= 300 && observation.status < 400)
    ) {
      return [];
    }
    const address = parseUrl(observation.url);
    return address !== undefined && context.isFirstParty(address, observation.page)
      ? [{ response: observation, address }]
      : [];
  });
}

/** The policies written into the page as <meta http-equiv>, per page address. */
function metaPolicies(observations: readonly Observation[]): Map<string, string[]> {
  const policies = new Map<string, string[]>();
  for (const event of pageEvents(observations, 'meta')) {
    const list = policies.get(event.page) ?? [];
    list.push(event.event.content);
    policies.set(event.page, list);
  }
  return policies;
}

export function headersRule(observations: readonly Observation[], context: Context): Finding[] {
  const config = context.options.headers;
  if (context.level('headers') === 'off' || config === undefined) {
    return [];
  }
  const meta = metaPolicies(observations);
  interface Item {
    issue: HeaderIssue;
    document: Document;
  }
  const items: Item[] = [];
  for (const document of ownDocuments(observations, context)) {
    const issues = checkHeaders(
      document.response.headers,
      {
        secure: document.address.protocol === 'https:',
        metaPolicy: (meta.get(document.response.page) ?? []).length > 0,
      },
      config,
    );
    items.push(...issues.map((issue) => ({ issue, document })));
  }
  return [
    ...group(items, (item) => `${item.issue.subject} ${item.issue.summary}`).entries(),
  ].flatMap(([, list]) => {
    const first = list[0];
    if (first === undefined) {
      return [];
    }
    const pages = [...new Set(list.map((item) => pathOf(item.document.response.url)))];
    return finding(context, 'headers', {
      subject: first.issue.subject,
      summary: first.issue.summary,
      details: [
        `on: ${pages.slice(0, 3).join(', ')}${pages.length > 3 ? ` and ${String(pages.length - 3)} more` : ''}`,
      ],
      count: pages.length,
      page: pathOf(first.document.response.url),
      at: first.document.response.at,
    });
  });
}

export function cspQualityRule(observations: readonly Observation[], context: Context): Finding[] {
  if (context.level('cspQuality') === 'off') {
    return [];
  }
  const meta = metaPolicies(observations);
  interface Item {
    issue: PolicyIssue;
    policy: string;
    page: string;
    at: number;
  }
  const items: Item[] = [];
  const seen = new Set<string>();
  for (const document of ownDocuments(observations, context)) {
    const header = document.response.headers['content-security-policy'];
    const policies = [
      ...(header === undefined ? [] : [{ text: header, meta: false }]),
      ...(meta.get(document.response.page) ?? []).map((text) => ({ text, meta: true })),
    ];
    for (const { text, meta: isMeta } of policies) {
      const key = `${document.response.page} ${text}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      for (const issue of checkPolicy(parsePolicy(text), { meta: isMeta })) {
        items.push({ issue, policy: text, page: document.response.page, at: document.response.at });
      }
    }
  }
  return [...group(items, (item) => item.issue.subject).entries()].flatMap(([, list]) => {
    const first = list[0];
    if (first === undefined) {
      return [];
    }
    return finding(context, 'cspQuality', {
      subject: first.issue.subject,
      summary: first.issue.summary,
      details: [`policy: ${cut(first.policy, 160)}`],
      count: list.length,
      page: pathOf(first.page),
      at: first.at,
    });
  });
}
