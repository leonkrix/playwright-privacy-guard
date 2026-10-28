/** What a rule does with what it finds. */
export type Level = 'error' | 'warn' | 'off';

/** Every rule of the guard. */
export const RULE_IDS = [
  'requests',
  'insecure',
  'cookies',
  'cookieAttributes',
  'storage',
  'csp',
  'errors',
  'apis',
  'forms',
  'referrer',
  'sri',
  'leaks',
  'headers',
  'cspQuality',
  'fingerprint',
] as const;

export type RuleId = (typeof RULE_IDS)[number];

/**
 * One thing that is allowed: the text or pattern alone, or with the reason it is allowed (the
 * reason shows up in the report, so the next reader knows why).
 */
export type Entry<T = string | RegExp> = T | { match: T; reason?: string };

/** The sensitive browser APIs that the `apis` rule knows. */
export const API_NAMES = [
  'geolocation',
  'camera-or-microphone',
  'screen-capture',
  'notifications',
  'webrtc',
  'clipboard-read',
  'midi',
  'bluetooth',
  'usb',
  'serial',
  'hid',
] as const;

export type ApiName = (typeof API_NAMES)[number];

/** The ways of recognising a browser that the `fingerprint` rule knows. */
export const FINGERPRINT_NAMES = ['canvas', 'webgl', 'audio', 'battery', 'fonts'] as const;

export type FingerprintName = (typeof FINGERPRINT_NAMES)[number];

/** What the page may do. Everything else is a finding. */
export interface Allow {
  /**
   * Origins and hosts that may be requested. A host (`api.example.com`), any subdomain
   * (`*.example.com`, not the bare domain), an origin with a scheme and port
   * (`https://cdn.example.com`, `localhost:4411`), an address prefix
   * (`https://cdn.example.com/lib/*`) or a regular expression tested against the whole address.
   */
  requests?: Entry[];
  /** Hosts that may be requested over http or ws (machine-local addresses always may) */
  insecure?: Entry[];
  /** Names of cookies: a name, a name with `*` at the end (`_ga*`) or a regular expression */
  cookies?: Entry[];
  /** Keys in localStorage, written like cookie names */
  localStorage?: Entry[];
  /** Keys in sessionStorage */
  sessionStorage?: Entry[];
  /** Names of IndexedDB databases */
  indexedDB?: Entry[];
  /** Names of Cache Storage caches */
  cacheStorage?: Entry[];
  /** Service workers may be registered */
  serviceWorkers?: boolean;
  /** Sensitive APIs the page may use, by name or `{ match: name, reason }` */
  apis?: Entry<ApiName>[];
  /**
   * Ways of recognising the browser that are fine (a game that reads pixels of its canvas), by name
   * or `{ match: name, reason }`
   */
  fingerprint?: Entry<FingerprintName>[];
  /**
   * Errors that are fine. Tested against the text of the finding, for example
   * `404 http://localhost/missing.png` or the message of a console error.
   */
  errors?: Entry[];
  /** Blocked addresses or directives that are fine (`img-src`, `https://x.test/a.png`) */
  csp?: Entry[];
  /** Third-party scripts and styles that may have no `integrity` attribute */
  integrity?: Entry[];
}

export type AllowKey = keyof Allow;

/** One thing the page did that an allow entry let pass: what the report lists as allowed on purpose. */
export interface AllowedUse {
  rule: RuleId;
  /** What it was: a host, a cookie name, a key, an error text, an API name */
  what: string;
  /** The entry that allowed it, as text */
  entry: string;
  /** Why, when the entry says so */
  reason?: string;
  /** How often it happened */
  count: number;
  /** The path of the first page it happened on */
  page: string;
}

/** What the `cookieAttributes` rule asks of the cookies that are allowed. */
export interface CookieAttributeOptions {
  /** An allowed cookie must be `Secure` (default true; not asked on machine-local hosts) */
  secure?: boolean;
  /** Names of cookies that must be `HttpOnly`, the ones that identify a visitor (`session*`) */
  httpOnly?: Entry[];
  /** An allowed cookie must not be set with `SameSite=None` (default true; only when it says so) */
  noSameSiteNone?: boolean;
  /** An allowed cookie must not live longer than this many days (default: no limit) */
  maxDays?: number;
}

/** Names of the checks of response headers. */
export type HeaderPreset = 'recommended' | 'strict';

/** A rule for one response header. */
export type HeaderRule = string | RegExp | ((value: string | undefined) => boolean | string);

export type HeaderRules = Record<string, HeaderRule>;

export interface PrivacyGuardOptions {
  /**
   * `enforce` (default) fails the test. `report` only attaches the report and never fails, to adopt
   * the guard in a project that is not clean yet.
   */
  mode?: 'enforce' | 'report';
  /**
   * Origins that count as your own besides the page itself and the `baseURL`. Same notation as
   * `allow.requests`.
   */
  firstParty?: Entry[];
  /** What the page may do */
  allow?: Allow;
  /** Level per rule (`error` fails the test, `warn` only reports, `off` does not look) */
  rules?: Partial<Record<RuleId, Level>>;
  /**
   * What is asked of the cookies that are allowed (the `cookieAttributes` rule, off until asked for
   * with `rules: { cookieAttributes: 'warn' }` or by setting this).
   */
  cookieAttributes?: CookieAttributeOptions;
  /**
   * Values that must never reach a third party (an e-mail address you typed in, a name). Looked for in
   * the address, the headers and the body of every request to another origin.
   */
  watch?: (string | RegExp)[];
  /**
   * Checks of response headers of the documents: `recommended` or your own rules per header. Off by
   * default, because a test server often does not send them.
   */
  headers?: HeaderPreset | { preset?: HeaderPreset; rules?: HeaderRules };
  /**
   * A file of findings that are known and accepted for now (see the README, "Adopting it in a
   * project that leaks today"). They are listed in the report and do not fail the test. Run with
   * `PRIVACY_GUARD_UPDATE=1` to write the findings of the run into the file.
   */
  baseline?: string;
  /** Keep the query strings and values out of the report (default false) */
  redact?: boolean;
  /** Stop collecting after this many observations (default 5000) */
  maxObservations?: number;
}

/** What a test file can set with `test.use`. `false` switches the guard off for the test. */
export interface PrivacyGuardTestOptions {
  privacyGuard: boolean | PrivacyGuardOptions;
}

/** Where something came from. */
export interface Source {
  /** The script (or document) that did it, when known */
  url?: string;
  line?: number;
  column?: number;
  /** The frame it happened in */
  frame?: string;
  /** What kind of request (script, image, fetch, ping, websocket, ...) */
  resourceType?: string;
}

export interface Tracker {
  /** The company, for example `Google Analytics` */
  entity: string;
  /** The kind of thing it does, for example `analytics` or `advertising` */
  category: string;
}

/** One problem the guard found. */
export interface Finding {
  rule: RuleId;
  level: 'error' | 'warn';
  /** What it is about, short: `www.google-analytics.com`, `cookie _ga`, `localStorage "theme"` */
  subject: string;
  /** One line that says what happened */
  summary: string;
  /** More lines (the address, the reason, the effect) */
  details: string[];
  /** How many times it happened */
  count: number;
  /** The path of the page it happened on */
  page: string;
  source?: Source;
  tracker?: Tracker;
  /** The part of the `allow` option that would allow it, for the hint in the report */
  allow?: { key: AllowKey; value: string };
  /** Milliseconds since the guard started */
  at: number;
}

/** The observations the page script reports. */
export type PageEvent =
  | { kind: 'cookie-write'; name: string; via: string; stack: string; script?: string }
  | {
      kind: 'storage-write';
      area: 'localStorage' | 'sessionStorage' | 'indexedDB' | 'cacheStorage' | 'serviceWorker';
      key: string;
      stack: string;
      script?: string;
    }
  | {
      kind: 'csp';
      blocked: string;
      directive: string;
      disposition: string;
      sample: string;
      sourceFile: string;
      line: number;
      column: number;
    }
  | { kind: 'api'; api: ApiName; stack: string; script?: string }
  | {
      kind: 'fingerprint';
      technique: FingerprintName;
      detail: string;
      stack: string;
      script?: string;
    }
  | { kind: 'hint'; rel: string; href: string }
  | { kind: 'form'; action: string; method: string }
  | { kind: 'ping'; href: string }
  | { kind: 'meta'; httpEquiv: string; content: string }
  | {
      kind: 'asset';
      tag: 'script' | 'link';
      href: string;
      integrity: boolean;
      crossorigin: boolean;
    };

/** Everything the guard sees, in the order it happened. Rules are pure functions over these. */
export type Observation = {
  at: number;
  page: string;
  frame: string;
  /** Which page of the test it was (the guard numbers them) */
  pageId?: number;
  /** The page was opened by another page (a link with `target="_blank"`, `window.open`) */
  popup?: boolean;
} & (
  | {
      kind: 'request';
      url: string;
      method: string;
      resourceType: string;
      referer?: string;
      body?: string;
      navigation: boolean;
    }
  | {
      kind: 'response';
      url: string;
      status: number;
      setCookies: string[];
      navigation: boolean;
      headers: Record<string, string>;
    }
  | { kind: 'request-failed'; url: string; error: string }
  | { kind: 'console'; type: string; text: string; location: string }
  | { kind: 'page-error'; message: string; stack: string }
  | { kind: 'page'; event: PageEvent }
);

export interface CookieState {
  name: string;
  domain: string;
  path: string;
  value: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

/** What the browser holds at the end of the test. */
export interface StateSnapshot {
  cookies: CookieState[];
  /** Per page and frame address */
  storage: {
    frame: string;
    page: string;
    localStorage: string[];
    sessionStorage: string[];
    indexedDB: string[];
    cacheStorage: string[];
    serviceWorkers: string[];
  }[];
  /** What was there before the test started (a stored login), which is not the page's doing */
  initial: {
    cookies: CookieState[];
    localStorage: { origin: string; name: string; value: string }[];
  };
}
