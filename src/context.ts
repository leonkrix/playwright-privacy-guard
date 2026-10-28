import { matchesUrl } from './match.js';
import { mergeAllow } from './options.js';
import type { ResolvedAllow, ResolvedOptions } from './options.js';
import { parseUrl, redactUrl } from './urls.js';
import type { Allow, AllowedUse, Level, RuleId } from './types.js';

/** An allow list that applies from a moment on (`privacy.allow()` in the middle of a test). */
export interface Allowance {
  at: number;
  allow: Allow;
}

/** What a rule needs to know besides the observations. */
export interface Context {
  options: ResolvedOptions;
  /** The origin of the `baseURL` of the test, when there is one */
  baseOrigin: string | undefined;
  /** What is allowed at a moment: the options plus every `privacy.allow()` made before it */
  allowAt: (at: number) => ResolvedAllow;
  level: (rule: RuleId) => Level;
  /** An address as it goes into the report (without query string when `redact` is set) */
  show: (address: string) => string;
  /** Is this address the page's own, or an origin that the test counts as its own? */
  isFirstParty: (address: URL, page: string) => boolean;
  /** Remembers that an allow entry let something pass, for the list of what is allowed on purpose */
  noteAllowed: (use: Omit<AllowedUse, 'count'> & { count?: number }) => void;
  /** What the allow entries let pass so far, most often first */
  allowedUses: () => AllowedUse[];
}

const EMPTY: Allow = {};

export function createContext(
  options: ResolvedOptions,
  baseOrigin: string | undefined,
  allowances: readonly Allowance[] = [],
): Context {
  const cache = new Map<string, ResolvedAllow>();
  const uses = new Map<string, AllowedUse>();
  const allowAt = (at: number): ResolvedAllow => {
    const active = allowances.filter((allowance) => allowance.at <= at);
    const key = String(active.length);
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const extra = active.reduce<Allow>((sum, allowance) => mergeAllow(sum, allowance.allow), EMPTY);
    const merged = mergeAllow(options.allow, extra) as Partial<ResolvedAllow>;
    const resolved: ResolvedAllow = {
      requests: merged.requests ?? [],
      insecure: merged.insecure ?? [],
      cookies: merged.cookies ?? [],
      localStorage: merged.localStorage ?? [],
      sessionStorage: merged.sessionStorage ?? [],
      indexedDB: merged.indexedDB ?? [],
      cacheStorage: merged.cacheStorage ?? [],
      errors: merged.errors ?? [],
      csp: merged.csp ?? [],
      integrity: merged.integrity ?? [],
      serviceWorkers: merged.serviceWorkers ?? false,
      apis: merged.apis ?? [],
      fingerprint: merged.fingerprint ?? [],
    };
    cache.set(key, resolved);
    return resolved;
  };
  return {
    options,
    baseOrigin,
    allowAt,
    level: (rule) => options.levels[rule],
    show: (address) => (options.redact ? redactUrl(address) : address),
    noteAllowed: (use) => {
      const key = `${use.rule}
${use.what}
${use.entry}`;
      const { count = 1, ...rest } = use;
      const known = uses.get(key);
      if (known === undefined) {
        uses.set(key, { ...rest, count });
      } else {
        known.count += count;
      }
    },
    allowedUses: () =>
      [...uses.values()].sort(
        (a, b) => b.count - a.count || a.rule.localeCompare(b.rule) || a.what.localeCompare(b.what),
      ),
    isFirstParty: (address, page) => {
      if (address.origin === parseUrl(page)?.origin || address.origin === baseOrigin) {
        return true;
      }
      return options.firstParty.some((entry) => matchesUrl(entry, address));
    },
  };
}
