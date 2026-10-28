import { toRule } from './match.js';
import {
  API_NAMES,
  FINGERPRINT_NAMES,
  type ApiName,
  type FingerprintName,
  type Allow,
  type AllowKey,
  type Entry,
  type HeaderPreset,
  type HeaderRules,
  type Level,
  type PrivacyGuardOptions,
  RULE_IDS,
  type RuleId,
} from './types.js';

/** What every rule does when nothing is set. */
export const DEFAULT_LEVELS: Readonly<Record<RuleId, Level>> = {
  requests: 'error',
  insecure: 'error',
  cookies: 'error',
  storage: 'error',
  csp: 'error',
  errors: 'error',
  apis: 'error',
  forms: 'error',
  referrer: 'warn',
  sri: 'warn',
  leaks: 'error',
  headers: 'error',
  cspQuality: 'warn',
  fingerprint: 'warn',
};

/** The rules that look at nothing until they are asked to. */
const OFF_UNTIL_ASKED: readonly RuleId[] = ['headers', 'cspQuality', 'fingerprint'];

export const DEFAULTS = {
  mode: 'enforce' as 'enforce' | 'report',
  redact: false,
  maxObservations: 5000,
};

/** The allow lists with every list there (empty when nothing is allowed). */
export interface ResolvedAllow {
  requests: Entry[];
  insecure: Entry[];
  cookies: Entry[];
  localStorage: Entry[];
  sessionStorage: Entry[];
  indexedDB: Entry[];
  cacheStorage: Entry[];
  errors: Entry[];
  csp: Entry[];
  integrity: Entry[];
  serviceWorkers: boolean;
  apis: ApiName[];
  fingerprint: FingerprintName[];
}

/** The options with every default filled in and every value checked. */
export interface ResolvedOptions {
  mode: 'enforce' | 'report';
  firstParty: Entry[];
  allow: ResolvedAllow;
  levels: Record<RuleId, Level>;
  watch: (string | RegExp)[];
  headers: { preset: HeaderPreset | undefined; rules: HeaderRules | undefined } | undefined;
  redact: boolean;
  maxObservations: number;
  baseline: string | undefined;
}

const ENTRY_KEYS = [
  'requests',
  'insecure',
  'cookies',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'cacheStorage',
  'errors',
  'csp',
  'integrity',
] as const satisfies readonly AllowKey[];

const name2 = (name: string): string => `allow.fingerprint has "${name}", which`;

function fail(message: string): never {
  throw new TypeError(`privacy-guard: ${message}`);
}

function checkEntries(name: string, value: unknown): Entry[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return fail(`${name} must be a list`);
  }
  for (const entry of value as unknown[]) {
    const { match } = toRule(entry as Entry);
    if (typeof match === 'string') {
      if (match.trim() === '') {
        fail(`${name} has an empty entry`);
      }
    } else if (!(match instanceof RegExp)) {
      fail(`${name} entries must be a text, a regular expression or { match, reason }`);
    }
  }
  return [...(value as Entry[])];
}

/** Checks the allow list (also used for `privacy.allow()`), so a typo fails at once. */
export function checkAllow(allow: Allow | undefined, name = 'allow'): Allow {
  if (allow === undefined) {
    return {};
  }
  const known = new Set<string>([...ENTRY_KEYS, 'serviceWorkers', 'apis', 'fingerprint']);
  for (const key of Object.keys(allow)) {
    if (!known.has(key)) {
      fail(`${name}.${key} is not an allow list (known: ${[...known].join(', ')})`);
    }
  }
  const checked: Allow = {};
  for (const key of ENTRY_KEYS) {
    if (allow[key] !== undefined) {
      checked[key] = checkEntries(`${name}.${key}`, allow[key]);
    }
  }
  if (allow.serviceWorkers !== undefined) {
    if (typeof allow.serviceWorkers !== 'boolean') {
      fail(`${name}.serviceWorkers must be true or false`);
    }
    checked.serviceWorkers = allow.serviceWorkers;
  }
  if (allow.apis !== undefined) {
    for (const api of allow.apis) {
      if (!API_NAMES.includes(api)) {
        fail(`${name}.apis has "${api as string}", which is not one of: ${API_NAMES.join(', ')}`);
      }
    }
    checked.apis = [...allow.apis];
  }
  if (allow.fingerprint !== undefined) {
    for (const name of allow.fingerprint) {
      if (!FINGERPRINT_NAMES.includes(name)) {
        fail(
          `${name2(name)} is not a way of recognising a browser (known: ${FINGERPRINT_NAMES.join(', ')})`,
        );
      }
    }
    checked.fingerprint = [...allow.fingerprint];
  }
  return checked;
}

/** Puts two allow lists together: everything of both is allowed. */
export function mergeAllow(base: Allow, extra: Allow): Allow {
  const merged: Allow = { ...base };
  for (const key of ENTRY_KEYS) {
    const more = extra[key];
    if (more !== undefined) {
      merged[key] = [...(base[key] ?? []), ...more];
    }
  }
  if (extra.serviceWorkers === true) {
    merged.serviceWorkers = true;
  }
  if (extra.apis !== undefined) {
    merged.apis = [...new Set([...(base.apis ?? []), ...extra.apis])];
  }
  if (extra.fingerprint !== undefined) {
    merged.fingerprint = [...new Set([...(base.fingerprint ?? []), ...extra.fingerprint])];
  }
  return merged;
}

function resolveHeaders(value: PrivacyGuardOptions['headers']): ResolvedOptions['headers'] {
  if (value === undefined) {
    return undefined;
  }
  const presets = ['recommended', 'strict'];
  if (typeof value === 'string') {
    if (!presets.includes(value)) {
      fail(`headers must be one of ${presets.join(', ')} or { preset, rules }, not "${value}"`);
    }
    return { preset: value, rules: undefined };
  }
  if (typeof value !== 'object' || value instanceof RegExp) {
    fail('headers must be a preset name or { preset, rules }');
  }
  if (value.preset !== undefined && !presets.includes(value.preset)) {
    fail(`headers.preset must be one of ${presets.join(', ')}, not "${value.preset}"`);
  }
  for (const [name, rule] of Object.entries(value.rules ?? {})) {
    if (name.trim() === '') {
      fail('headers.rules has an empty header name');
    }
    if (typeof rule !== 'string' && typeof rule !== 'function' && !(rule instanceof RegExp)) {
      fail(`headers.rules["${name}"] must be a text, a regular expression or a function`);
    }
  }
  return { preset: value.preset, rules: value.rules };
}

/** Fills in the defaults and refuses values that cannot work. */
export function resolveOptions(options: PrivacyGuardOptions = {}): ResolvedOptions {
  const mode: string = options.mode ?? DEFAULTS.mode;
  if (mode !== 'enforce' && mode !== 'report') {
    fail(`mode must be "enforce" or "report", not "${mode}"`);
  }
  const levels: Record<RuleId, Level> = { ...DEFAULT_LEVELS };
  for (const rule of OFF_UNTIL_ASKED) {
    levels[rule] = 'off';
  }
  if (options.headers !== undefined) {
    levels.headers = DEFAULT_LEVELS.headers;
    levels.cspQuality = DEFAULT_LEVELS.cspQuality;
  }
  for (const [rule, level] of Object.entries(options.rules ?? {})) {
    if (!(RULE_IDS as readonly string[]).includes(rule)) {
      fail(`rules.${rule} is not a rule (known: ${RULE_IDS.join(', ')})`);
    }
    if (!['error', 'warn', 'off'].includes(level)) {
      fail(`rules.${rule} must be "error", "warn" or "off", not "${level}"`);
    }
    levels[rule as RuleId] = level;
  }
  const maxObservations = options.maxObservations ?? DEFAULTS.maxObservations;
  if (!Number.isInteger(maxObservations) || maxObservations < 1) {
    fail('maxObservations must be a whole number of 1 or more');
  }
  if (options.baseline?.trim() === '') {
    fail('baseline must be the path of a file');
  }
  const headers = resolveHeaders(options.headers);
  const allow = checkAllow(options.allow);
  for (const value of options.watch ?? []) {
    if (typeof value === 'string' ? value === '' : !(value instanceof RegExp)) {
      fail('watch must hold texts (not empty) or regular expressions');
    }
  }
  return {
    mode,
    firstParty: checkEntries('firstParty', options.firstParty),
    allow: {
      requests: allow.requests ?? [],
      insecure: allow.insecure ?? [],
      cookies: allow.cookies ?? [],
      localStorage: allow.localStorage ?? [],
      sessionStorage: allow.sessionStorage ?? [],
      indexedDB: allow.indexedDB ?? [],
      cacheStorage: allow.cacheStorage ?? [],
      errors: allow.errors ?? [],
      csp: allow.csp ?? [],
      integrity: allow.integrity ?? [],
      serviceWorkers: allow.serviceWorkers ?? false,
      apis: allow.apis ?? [],
      fingerprint: allow.fingerprint ?? [],
    },
    levels,
    watch: [...(options.watch ?? [])],
    headers,
    baseline: options.baseline,
    redact: options.redact ?? DEFAULTS.redact,
    maxObservations,
  };
}
