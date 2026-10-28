import type { Entry } from './types.js';

/** An entry of an allow list, with the reason split off. */
export interface Rule {
  match: string | RegExp;
  reason?: string;
}

export function toRule(entry: Entry): Rule {
  if (typeof entry === 'string' || entry instanceof RegExp) {
    return { match: entry };
  }
  return entry.reason === undefined
    ? { match: entry.match }
    : { match: entry.match, reason: entry.reason };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** `RegExp.test` with a global or sticky flag keeps a position between calls: start from the beginning. */
function testRegExp(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

/** A name where `*` stands for any text: `_ga*` matches `_ga` and `_ga_ABC123`. */
export function matchesName(entry: Entry, name: string): boolean {
  const { match } = toRule(entry);
  if (match instanceof RegExp) {
    return testRegExp(match, name);
  }
  if (!match.includes('*')) {
    return match === name;
  }
  const pattern = match.split('*').map(escapeRegExp).join('.*');
  return new RegExp(`^${pattern}$`, 's').test(name);
}

/** A text that is searched for a piece (error messages): a string matches when it is contained. */
export function matchesText(entry: Entry, text: string): boolean {
  const { match } = toRule(entry);
  return match instanceof RegExp ? testRegExp(match, text) : text.includes(match);
}

/**
 * Does an address match an entry of `allow.requests` or `firstParty`?
 *
 * - `example.com` is that host (any scheme, any port), `example.com:8443` also needs the port
 * - `*.example.com` is any subdomain at any depth, not `example.com` itself
 * - `https://example.com` is that origin, `https://example.com/lib/*` is an address prefix
 * - a regular expression is tested against the whole address
 */
export function matchesUrl(entry: Entry, address: URL): boolean {
  const { match } = toRule(entry);
  if (match instanceof RegExp) {
    return testRegExp(match, address.href);
  }
  const wanted = match.trim().toLowerCase();
  if (wanted.includes('://')) {
    if (wanted.endsWith('*')) {
      return address.href.toLowerCase().startsWith(wanted.slice(0, -1));
    }
    let parsed: URL;
    try {
      parsed = new URL(wanted);
    } catch {
      return false;
    }
    const pathless = !wanted.replace(/^[a-z-]+:\/\//, '').includes('/');
    return pathless
      ? parsed.origin === address.origin
      : address.href.toLowerCase().startsWith(parsed.href.toLowerCase());
  }
  const withPort = /:\d+$/.test(wanted);
  const host = withPort ? address.host.toLowerCase() : address.hostname.toLowerCase();
  if (wanted.startsWith('*.')) {
    return host.endsWith(wanted.slice(1));
  }
  return host === wanted;
}

/** An entry as text for the report: the text, or the regular expression with its slashes. */
export function describeEntry(entry: Entry): string {
  const { match } = toRule(entry);
  return typeof match === 'string' ? match : String(match);
}

/** The reason of the first entry that matches, `undefined` when none has one. */
export function reasonFor(
  entries: readonly Entry[],
  matches: (entry: Entry) => boolean,
): string | undefined {
  const found = entries.find(matches);
  return found === undefined ? undefined : toRule(found).reason;
}
