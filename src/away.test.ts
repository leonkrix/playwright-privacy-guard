import { describe, expect, it } from 'vitest';

import { withoutAwayPages } from './away.js';
import { createContext } from './context.js';
import { resolveOptions } from './options.js';
import type { CookieState, Observation, StateSnapshot } from './types.js';

const cookie = (domain: string): CookieState => ({
  name: 'c',
  domain,
  path: '/',
  value: '1',
  expires: -1,
  httpOnly: false,
  secure: false,
  sameSite: 'Lax',
});

const request = (page: string, url: string, popup = false): Observation => ({
  at: 1,
  page,
  frame: page,
  kind: 'request',
  url,
  method: 'GET',
  resourceType: 'script',
  navigation: false,
  ...(popup ? { popup: true } : {}),
});

const state = (cookies: CookieState[]): StateSnapshot => ({
  cookies,
  storage: [],
  initial: { cookies: [], localStorage: [] },
});

const context = (firstParty: string[] = []) =>
  createContext(resolveOptions({ firstParty }), 'https://site.test');

describe('withoutAwayPages', () => {
  it('changes nothing when no page was opened by another', () => {
    const observations = [request('https://site.test/', 'https://cdn.test/a.js')];
    const result = withoutAwayPages(observations, undefined, context());
    expect(result.observations).toBe(observations);
  });

  it('drops what a tab on another website did, and its cookies', () => {
    const result = withoutAwayPages(
      [
        request('https://site.test/', 'https://site.test/app.js'),
        request('https://other.test/page', 'https://static.other.test/x.js', true),
      ],
      state([cookie('.other.test'), cookie('site.test')]),
      context(),
    );
    expect(result.observations.map((item) => item.page)).toEqual(['https://site.test/']);
    expect(result.snapshot?.cookies.map((item) => item.domain)).toEqual(['site.test']);
  });

  it('keeps a cookie that the own site also uses', () => {
    const result = withoutAwayPages(
      [
        request('https://site.test/', 'https://shared.test/pixel.gif'),
        request('https://shared.test/', 'https://shared.test/x.js', true),
      ],
      state([cookie('shared.test')]),
      context(),
    );
    expect(result.snapshot?.cookies).toHaveLength(1);
  });

  it('judges a tab on the own site, on a first party origin, and a tab that has not loaded', () => {
    const own = request('https://site.test/other', 'https://cdn.test/a.js', true);
    const listed = request('https://app.site2.test/', 'https://cdn.test/a.js', true);
    const result = withoutAwayPages([own, listed], undefined, context(['app.site2.test']));
    expect(result.observations).toEqual([own, listed]);
    const empty = request('about:blank', 'https://cdn.test/a.js', true);
    expect(withoutAwayPages([empty], undefined, context()).observations).toEqual([]);
  });
});
