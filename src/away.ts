import type { Context } from './context.js';
import { matchesUrl } from './match.js';
import { isNetworkUrl, parseUrl } from './urls.js';
import type { Observation, StateSnapshot } from './types.js';

const originOf = (address: string): string | undefined => {
  const parsed = parseUrl(address);
  return parsed !== undefined && isNetworkUrl(parsed) ? parsed.origin : undefined;
};

/** Is `domain` of a cookie (`.example.com`) the host, or a parent of it? */
const covers = (domain: string, host: string): boolean => {
  const wanted = domain.replace(/^\./, '').toLowerCase();
  return host === wanted || host.endsWith(`.${wanted}`);
};

/**
 * A link that opens another website in a new tab is the page leaving the site: what that website
 * does is its own business, not a leak of the page under test. The tab is one that the page opened
 * (`popup`), and it counts as left when its address is not the test's own (the `baseURL`, a
 * `firstParty` entry, or the address of any page that was not opened by another one).
 *
 * Everything that tab and the website behind it did is taken out before the rules look: its
 * requests, messages and writes, the cookies of its hosts and the storage of its origin. A tab that
 * stays on the own site is still judged like any other page.
 */
export function withoutAwayPages(
  observations: readonly Observation[],
  snapshot: StateSnapshot | undefined,
  context: Context,
): { observations: readonly Observation[]; snapshot: StateSnapshot | undefined } {
  if (!observations.some((observation) => observation.popup === true)) {
    return { observations, snapshot };
  }
  const home = new Set<string>();
  if (context.baseOrigin !== undefined) {
    home.add(context.baseOrigin);
  }
  for (const observation of observations) {
    const origin = observation.popup === true ? undefined : originOf(observation.page);
    if (origin !== undefined) {
      home.add(origin);
    }
  }
  const isAway = (observation: Observation): boolean => {
    if (observation.popup !== true) {
      return false;
    }
    const parsed = parseUrl(observation.page);
    if (parsed === undefined || !isNetworkUrl(parsed)) {
      // A tab that has not loaded anything yet has nothing to judge
      return true;
    }
    return (
      !home.has(parsed.origin) &&
      !context.options.firstParty.some((entry) => matchesUrl(entry, parsed))
    );
  };

  const kept: Observation[] = [];
  const awayOrigins = new Set<string>();
  const awayHosts = new Set<string>();
  const keptHosts = new Set<string>();
  for (const observation of observations) {
    const hosts: string[] = [];
    if (observation.kind === 'request' || observation.kind === 'response') {
      const host = parseUrl(observation.url)?.hostname.toLowerCase();
      if (host !== undefined) {
        hosts.push(host);
      }
    }
    if (isAway(observation)) {
      const origin = originOf(observation.page);
      if (origin !== undefined) {
        awayOrigins.add(origin);
      }
      for (const host of hosts) {
        awayHosts.add(host);
      }
    } else {
      kept.push(observation);
      for (const host of hosts) {
        keptHosts.add(host);
      }
    }
  }
  if (snapshot === undefined) {
    return { observations: kept, snapshot };
  }
  const belongsToAway = (domain: string): boolean =>
    [...awayHosts].some((host) => covers(domain, host)) &&
    ![...keptHosts].some((host) => covers(domain, host));
  return {
    observations: kept,
    snapshot: {
      ...snapshot,
      cookies: snapshot.cookies.filter((cookie) => !belongsToAway(cookie.domain)),
      storage: snapshot.storage.filter((entry) => {
        const origin = originOf(entry.page);
        return origin === undefined || !awayOrigins.has(origin) || home.has(origin);
      }),
    },
  };
}
