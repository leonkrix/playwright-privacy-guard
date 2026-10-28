import { describe, expect, it } from 'vitest';

import { checkAllow, DEFAULT_LEVELS, mergeAllow, resolveOptions } from './options.js';

describe('resolveOptions', () => {
  it('fills in the defaults', () => {
    const resolved = resolveOptions();
    expect(resolved.mode).toBe('enforce');
    expect(resolved.redact).toBe(false);
    expect(resolved.maxObservations).toBe(5000);
    expect(resolved.levels.requests).toBe('error');
    expect(resolved.levels.referrer).toBe('warn');
    expect(resolved.allow.requests).toEqual([]);
    expect(resolved.allow.serviceWorkers).toBe(false);
  });

  it('keeps the rules that need asking off until they are asked for', () => {
    const resolved = resolveOptions();
    expect(resolved.levels.headers).toBe('off');
    expect(resolved.levels.cspQuality).toBe('off');
    expect(resolved.levels.fingerprint).toBe('off');
  });

  it('switches the header rules on when headers are given', () => {
    const resolved = resolveOptions({ headers: 'recommended' });
    expect(resolved.levels.headers).toBe(DEFAULT_LEVELS.headers);
    expect(resolved.levels.cspQuality).toBe(DEFAULT_LEVELS.cspQuality);
    expect(resolved.headers).toEqual({ preset: 'recommended', rules: undefined });
  });

  it('takes a preset with rules of its own', () => {
    const resolved = resolveOptions({ headers: { preset: 'strict', rules: { 'x-a': 'absent' } } });
    expect(resolved.headers).toEqual({ preset: 'strict', rules: { 'x-a': 'absent' } });
  });

  it('lets a rule be set by hand', () => {
    expect(resolveOptions({ rules: { requests: 'warn' } }).levels.requests).toBe('warn');
    expect(
      resolveOptions({ headers: 'recommended', rules: { headers: 'off' } }).levels.headers,
    ).toBe('off');
  });

  it('refuses what cannot work, and says which option', () => {
    expect(() => resolveOptions({ mode: 'loud' as 'report' })).toThrow('mode must be');
    expect(() => resolveOptions({ rules: { nope: 'off' } as never })).toThrow(
      'rules.nope is not a rule',
    );
    expect(() => resolveOptions({ rules: { requests: 'loud' as 'off' } })).toThrow(
      'rules.requests must be',
    );
    expect(() => resolveOptions({ maxObservations: 0 })).toThrow('maxObservations');
    expect(() => resolveOptions({ maxObservations: 1.5 })).toThrow('maxObservations');
    expect(() => resolveOptions({ headers: 'lax' as 'strict' })).toThrow('headers must be one of');
    expect(() => resolveOptions({ headers: { preset: 'lax' as 'strict' } })).toThrow(
      'headers.preset must be',
    );
    expect(() => resolveOptions({ headers: { rules: { x: 3 as unknown as string } } })).toThrow(
      'headers.rules["x"]',
    );
    expect(() => resolveOptions({ watch: [''] })).toThrow('watch must hold');
    expect(() => resolveOptions({ firstParty: ['  '] })).toThrow('firstParty has an empty entry');
  });
});

describe('checkAllow', () => {
  it('refuses a list that does not exist', () => {
    expect(() => checkAllow({ cookie: ['a'] } as never)).toThrow(
      'allow.cookie is not an allow list',
    );
  });

  it('refuses an entry that is not a text, a pattern or { match }', () => {
    expect(() => checkAllow({ requests: [3 as unknown as string] })).toThrow(
      'allow.requests entries must be',
    );
    expect(() => checkAllow({ requests: 'a.test' as unknown as string[] })).toThrow(
      'allow.requests must be a list',
    );
  });

  it('refuses an API it does not know and a service worker flag that is not a boolean', () => {
    expect(() => checkAllow({ apis: ['smell' as 'webrtc'] })).toThrow('allow.apis has "smell"');
    expect(() => checkAllow({ serviceWorkers: 'yes' as unknown as boolean })).toThrow(
      'allow.serviceWorkers must be true or false',
    );
  });

  it('names the place in the message', () => {
    expect(() => checkAllow({ cookie: ['a'] } as never, 'allow()')).toThrow('allow().cookie');
  });
});

describe('mergeAllow', () => {
  it('puts the lists together and does not change the first', () => {
    const base = { requests: ['a.test'], apis: ['webrtc' as const] };
    const merged = mergeAllow(base, {
      requests: ['b.test'],
      cookies: ['x'],
      apis: ['webrtc', 'midi'],
      serviceWorkers: true,
    });
    expect(merged).toEqual({
      requests: ['a.test', 'b.test'],
      cookies: ['x'],
      apis: ['webrtc', 'midi'],
      serviceWorkers: true,
    });
    expect(base).toEqual({ requests: ['a.test'], apis: ['webrtc'] });
  });
});
