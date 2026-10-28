import { describe, expect, it } from 'vitest';

import { aggregate, renderMarkdown, renderSiteHtml } from './aggregate.js';
import { createContext } from './context.js';
import { evaluate } from './evaluate.js';
import { formatAllowed } from './format.js';
import { checkAllow, resolveOptions } from './options.js';
import { renderHtml } from './report-html.js';
import type {
  AllowedUse,
  CookieState,
  Observation,
  PrivacyGuardOptions,
  StateSnapshot,
} from './types.js';

const cookie = (name: string, extra: Partial<CookieState> = {}): CookieState => ({
  name,
  domain: 'shop.example',
  path: '/',
  value: '1',
  expires: -1,
  httpOnly: false,
  secure: false,
  sameSite: 'Lax',
  ...extra,
});

const state = (cookies: CookieState[]): StateSnapshot => ({
  cookies,
  storage: [],
  initial: { cookies: [], localStorage: [] },
});

const response = (setCookies: string[]): Observation => ({
  at: 1,
  page: 'https://shop.example/',
  frame: 'https://shop.example/',
  kind: 'response',
  url: 'https://shop.example/',
  status: 200,
  navigation: true,
  setCookies,
  headers: {},
});

const run = (
  options: PrivacyGuardOptions,
  observations: Observation[],
  snapshot?: StateSnapshot,
) => {
  const context = createContext(resolveOptions(options), 'https://shop.example');
  const findings = evaluate(observations, snapshot, context);
  return { findings, allowed: context.allowedUses() };
};

describe('cookieAttributes', () => {
  const allow = { cookies: ['session', 'theme', 'cross'] };

  it('is off until it is asked for', () => {
    const { findings } = run({ allow }, [], state([cookie('session')]));
    expect(findings).toEqual([]);
  });

  it('asks an allowed cookie to be Secure, but not on a machine-local host', () => {
    const options = { allow, rules: { cookieAttributes: 'warn' as const } };
    const weak = run(options, [], state([cookie('session')])).findings;
    expect(weak).toHaveLength(1);
    expect(weak[0]).toMatchObject({
      rule: 'cookieAttributes',
      level: 'warn',
      subject: 'cookie session',
    });
    expect(weak[0]?.summary).toContain('not Secure');
    const local = run(options, [], state([cookie('session', { domain: 'localhost' })])).findings;
    expect(local).toEqual([]);
    const fine = run(options, [], state([cookie('session', { secure: true })])).findings;
    expect(fine).toEqual([]);
  });

  it('does not repeat a cookie that is not allowed (the cookies rule has it)', () => {
    const { findings } = run({ rules: { cookieAttributes: 'warn' } }, [], state([cookie('x')]));
    expect(findings.map((found) => found.rule)).toEqual(['cookies']);
  });

  it('asks for HttpOnly by name, for the cookies that identify a visitor', () => {
    const options = { allow, cookieAttributes: { secure: false, httpOnly: ['session*'] } };
    const found = run(options, [], state([cookie('session'), cookie('theme')])).findings;
    expect(found.map((item) => item.subject)).toEqual(['cookie session']);
    expect(found[0]?.summary).toContain('not HttpOnly');
  });

  it('asks for a lifetime, when asked', () => {
    const options = { allow, cookieAttributes: { secure: false, maxDays: 30 } };
    const year = Math.floor(Date.now() / 1000) + 365 * 86_400;
    const found = run(options, [], state([cookie('theme', { expires: year })])).findings;
    expect(found).toHaveLength(1);
    expect(found[0]?.summary).toContain('lives for 365 days');
    const short = Math.floor(Date.now() / 1000) + 10 * 86_400;
    expect(run(options, [], state([cookie('theme', { expires: short })])).findings).toEqual([]);
  });

  it('finds SameSite=None only when the header says so', () => {
    const options = { allow, cookieAttributes: { secure: false } };
    const header = response(['cross=1; Path=/; SameSite=None; Secure']);
    const found = run(options, [header], state([cookie('cross', { sameSite: 'None' })])).findings;
    expect(found).toHaveLength(1);
    expect(found[0]?.summary).toContain('SameSite=None');
    const silent = run(options, [], state([cookie('cross', { sameSite: 'None' })])).findings;
    expect(silent).toEqual([]);
    const off = { allow, cookieAttributes: { secure: false, noSameSiteNone: false } };
    expect(run(off, [header], state([cookie('cross')])).findings).toEqual([]);
  });

  it('refuses settings that cannot work', () => {
    expect(() => resolveOptions({ cookieAttributes: { maxDays: 0 } })).toThrow('maxDays');
    expect(() => resolveOptions({ cookieAttributes: { secure: 'yes' as never } })).toThrow(
      'true or false',
    );
    expect(() => resolveOptions({ cookieAttributes: { nope: true } as never })).toThrow('nope');
  });
});

describe('what is allowed on purpose', () => {
  const request = (url: string): Observation => ({
    at: 1,
    page: 'https://shop.example/pay',
    frame: 'https://shop.example/pay',
    kind: 'request',
    url,
    method: 'GET',
    resourceType: 'script',
    navigation: false,
  });

  it('lists the entry, its reason and how often it let something pass', () => {
    const { findings, allowed } = run(
      {
        allow: {
          requests: [{ match: '*.stripe.com', reason: 'payments' }],
          cookies: ['session'],
        },
      },
      [request('https://js.stripe.com/a.js'), request('https://js.stripe.com/b.js')],
      state([cookie('session')]),
    );
    expect(findings).toEqual([]);
    expect(allowed).toEqual([
      {
        rule: 'requests',
        what: 'js.stripe.com',
        entry: '*.stripe.com',
        reason: 'payments',
        count: 2,
        page: '/pay',
      },
      expect.objectContaining({ rule: 'cookies', what: 'cookie session', entry: 'session' }),
    ]);
    expect(allowed[1]).not.toHaveProperty('reason');
  });

  it('only lists what really happened', () => {
    const { allowed } = run({ allow: { requests: ['never.example'] } }, []);
    expect(allowed).toEqual([]);
  });

  it('takes a reason for an api and a way of recognising a browser', () => {
    const checked = checkAllow({
      apis: [{ match: 'clipboard-read', reason: 'the test reads what was copied' }, 'webrtc'],
      fingerprint: [{ match: 'canvas', reason: 'axe-core reads pixels for the contrast' }],
    });
    expect(checked.apis).toHaveLength(2);
    expect(() => checkAllow({ apis: [{ match: 'telepathy' as never }] })).toThrow('telepathy');
    expect(() => checkAllow({ fingerprint: [{ match: 'smell' as never }] })).toThrow('smell');
    const api: Observation = {
      at: 1,
      page: 'https://shop.example/',
      frame: '',
      kind: 'page',
      event: { kind: 'api', api: 'clipboard-read', stack: '' },
    };
    const { findings, allowed } = run(
      { allow: { apis: [{ match: 'clipboard-read', reason: 'the test reads what was copied' }] } },
      [api],
    );
    expect(findings).toEqual([]);
    expect(allowed[0]).toMatchObject({
      rule: 'apis',
      what: 'API clipboard-read',
      reason: 'the test reads what was copied',
    });
  });

  const uses: AllowedUse[] = [
    {
      rule: 'requests',
      what: 'js.stripe.com',
      entry: '*.stripe.com',
      reason: 'payments',
      count: 2,
      page: '/pay',
    },
    { rule: 'cookies', what: 'cookie session', entry: '/^sess/', count: 1, page: '/' },
  ];

  it('is written into the text and the page of a report', () => {
    const text = formatAllowed(uses);
    expect(text).toContain('Allowed on purpose (2)');
    expect(text).toContain('Requests to other origins: js.stripe.com (2x)');
    expect(text).toContain('allowed by: *.stripe.com');
    expect(text).toContain('reason: payments');
    expect(text).toContain('reason: none given');
    expect(formatAllowed([])).toBe('');
    const html = renderHtml({
      generatedAt: 'now',
      mode: 'enforce',
      findings: [],
      allowed: uses,
      counts: { errors: 0, warnings: 0 },
      pages: [],
      dropped: 0,
    });
    expect(html).toContain('Allowed on purpose (2)');
    expect(html).toContain('payments');
    expect(html).toContain('none given');
  });

  it('is put together over all tests, with the tests that needed it', () => {
    const result = aggregate(
      [
        { test: 'a', report: { findings: [], allowed: uses } },
        { test: 'b', report: { findings: [], allowed: uses.slice(0, 1) } },
      ],
      5,
    );
    expect(result.allowed).toHaveLength(2);
    expect(result.allowed[0]).toMatchObject({ what: 'js.stripe.com', count: 4 });
    expect(result.allowed[0]?.tests).toEqual(['a', 'b']);
    const markdown = renderMarkdown(result);
    expect(markdown).toContain('No findings in 5 tests.');
    expect(markdown).toContain('### Allowed on purpose (2)');
    expect(markdown).toContain('js.stripe.com | `*.stripe.com` | payments | 2 |');
    const html = renderSiteHtml(result);
    expect(html).toContain('Allowed on purpose (2)');
    expect(html).toContain('payments');
  });
});
