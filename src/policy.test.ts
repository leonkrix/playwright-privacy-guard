import { describe, expect, it } from 'vitest';

import { checkPolicy, parsePolicy } from './csp.js';
import { checkHeaders } from './headers.js';
import { parseSetCookie } from './rules.js';
import { isTracking, trackerOf } from './trackers.js';

describe('parsePolicy', () => {
  it('reads directives and sources, the first of a repeated directive wins', () => {
    const policy = parsePolicy("default-src 'self'; img-src 'self' data:; img-src *;");
    expect(policy.get('default-src')).toEqual(["'self'"]);
    expect(policy.get('img-src')).toEqual(["'self'", 'data:']);
    expect(policy.size).toBe(2);
  });
});

describe('checkPolicy', () => {
  const subjects = (text: string, meta = false): string[] =>
    checkPolicy(parsePolicy(text), { meta }).map((issue) => issue.subject);

  it('has nothing to say about a tight policy', () => {
    expect(
      subjects("default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"),
    ).toEqual([]);
  });

  it("finds 'unsafe-inline' and 'unsafe-eval' in the script source", () => {
    expect(
      subjects(
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      ),
    ).toEqual(["script-src allows 'unsafe-inline'", "script-src allows 'unsafe-eval'"]);
  });

  it("ignores 'unsafe-inline' when a nonce, a hash or strict-dynamic makes browsers ignore it", () => {
    for (const source of ["'nonce-abc'", "'sha256-abc='", "'strict-dynamic'"]) {
      expect(
        subjects(
          `script-src 'self' 'unsafe-inline' ${source}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
        ),
      ).toEqual([]);
    }
  });

  it('finds a wildcard or a whole scheme for scripts, unless strict-dynamic is there', () => {
    expect(
      subjects("script-src * https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"),
    ).toEqual(['script-src allows * https:']);
    expect(
      subjects(
        "script-src https: 'strict-dynamic' 'nonce-a'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      ),
    ).toEqual([]);
  });

  it('uses default-src when there is no script-src, and names it', () => {
    expect(
      subjects(
        "default-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      ),
    ).toEqual(["default-src allows 'unsafe-inline'"]);
  });

  it('finds what is missing', () => {
    expect(subjects('img-src *')).toEqual([
      'no script-src or default-src',
      'object-src is not restricted',
      'base-uri is missing',
      'frame-ancestors is missing',
    ]);
  });

  it('does not ask a meta tag for frame-ancestors, which it cannot carry', () => {
    expect(subjects("default-src 'self'; object-src 'none'; base-uri 'self'", true)).toEqual([]);
  });
});

describe('checkHeaders', () => {
  const secure = { secure: true, metaPolicy: false };
  const good = {
    'strict-transport-security': 'max-age=31536000',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'self'",
  };
  const preset = { preset: 'recommended' as const, rules: undefined };

  it('accepts good headers', () => {
    expect(checkHeaders(good, secure, preset)).toEqual([]);
  });

  it('wants Strict-Transport-Security only on https, and long enough', () => {
    const { 'strict-transport-security': _removed, ...without } = good;
    expect(checkHeaders(without, secure, preset).map((item) => item.subject)).toEqual([
      'header strict-transport-security',
    ]);
    expect(checkHeaders(without, { secure: false, metaPolicy: false }, preset)).toEqual([]);
    expect(
      checkHeaders({ ...good, 'strict-transport-security': 'max-age=60' }, secure, preset)[0]
        ?.summary,
    ).toContain('too short');
  });

  it('accepts frame-ancestors instead of X-Frame-Options, and a meta policy instead of the header', () => {
    const { 'x-frame-options': _frame, 'content-security-policy': _csp, ...rest } = good;
    expect(
      checkHeaders(
        { ...rest, 'content-security-policy': "frame-ancestors 'none'" },
        secure,
        preset,
      ),
    ).toEqual([]);
    expect(
      checkHeaders(
        { ...rest, 'x-frame-options': 'DENY' },
        { secure: true, metaPolicy: true },
        preset,
      ),
    ).toEqual([]);
  });

  it('flags the referrer policies that send too much', () => {
    expect(
      checkHeaders({ ...good, 'referrer-policy': 'unsafe-url' }, secure, preset)[0]?.subject,
    ).toBe('header referrer-policy');
    expect(
      checkHeaders({ ...good, 'referrer-policy': 'no-referrer, strict-origin' }, secure, preset),
    ).toEqual([]);
  });

  it('flags a server that names its software', () => {
    const issues = checkHeaders(
      { ...good, 'x-powered-by': 'PHP/8.1', server: 'Apache/2.4' },
      secure,
      preset,
    );
    expect(issues.map((item) => item.subject)).toEqual(['header x-powered-by', 'header server']);
    expect(checkHeaders({ ...good, server: 'cloudflare' }, secure, preset)).toEqual([]);
  });

  it('runs your rules after the preset, with every kind of rule', () => {
    const issues = checkHeaders({ 'x-a': '1', 'x-b': 'yes', 'x-c': 'zzz' }, secure, {
      preset: undefined,
      rules: {
        'X-A': 'absent',
        'x-b': 'no',
        'x-c': /^a/,
        'x-d': 'present',
        'x-e': () => 'always wrong',
        'x-f': () => true,
      },
    });
    expect(issues.map((item) => `${item.subject}: ${item.summary}`)).toEqual([
      'header x-a: is set (1) but must not be',
      'header x-b: is yes but should be no',
      'header x-c: zzz does not match /^a/',
      'header x-d: missing',
      'header x-e: always wrong',
    ]);
  });
});

describe('parseSetCookie', () => {
  it('reads the name and the attributes', () => {
    const cookie = parseSetCookie('id=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600');
    expect(cookie?.name).toBe('id');
    expect(cookie?.gone).toBe(false);
    expect(cookie?.attributes.get('samesite')).toBe('Lax');
    expect(cookie?.attributes.has('httponly')).toBe(true);
  });

  it('knows a cookie that is being deleted', () => {
    expect(parseSetCookie('id=; Max-Age=0')?.gone).toBe(true);
    expect(parseSetCookie('id=; Expires=Thu, 01 Jan 1970 00:00:00 GMT')?.gone).toBe(true);
    expect(parseSetCookie('id=1; Expires=Fri, 01 Jan 2100 00:00:00 GMT')?.gone).toBe(false);
  });

  it('gives up on a header without a name', () => {
    expect(parseSetCookie('=1')).toBeUndefined();
    expect(parseSetCookie('')).toBeUndefined();
  });
});

describe('trackerOf', () => {
  it('names the company and the kind of business, also for a subdomain', () => {
    expect(trackerOf('www.google-analytics.com')).toMatchObject({ category: 'analytics' });
    expect(trackerOf('a.b.google-analytics.com')?.entity).toMatch(/Google/);
    expect(isTracking(trackerOf('www.google-analytics.com'))).toBe(true);
  });

  it('knows nothing about a host that is not in the list', () => {
    expect(trackerOf('example.org')).toBeUndefined();
    expect(trackerOf('localhost')).toBeUndefined();
    expect(isTracking(undefined)).toBe(false);
  });
});
