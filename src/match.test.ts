import { describe, expect, it } from 'vitest';

import { matchesName, matchesText, matchesUrl, reasonFor } from './match.js';

const url = (address: string): URL => new URL(address);

describe('matchesUrl', () => {
  it('matches a host with any scheme and port', () => {
    expect(matchesUrl('api.example.com', url('https://api.example.com/x'))).toBe(true);
    expect(matchesUrl('api.example.com', url('http://api.example.com:8080/x'))).toBe(true);
    expect(matchesUrl('api.example.com', url('https://example.com/x'))).toBe(false);
    expect(matchesUrl('API.Example.com', url('https://api.example.com/'))).toBe(true);
  });

  it('matches a host with a port only on that port', () => {
    expect(matchesUrl('localhost:4411', url('http://localhost:4411/a'))).toBe(true);
    expect(matchesUrl('localhost:4411', url('http://localhost:4412/a'))).toBe(false);
  });

  it('matches subdomains of any depth but not the bare domain', () => {
    expect(matchesUrl('*.example.com', url('https://cdn.example.com/a'))).toBe(true);
    expect(matchesUrl('*.example.com', url('https://a.b.example.com/a'))).toBe(true);
    expect(matchesUrl('*.example.com', url('https://example.com/a'))).toBe(false);
    expect(matchesUrl('*.example.com', url('https://badexample.com/a'))).toBe(false);
  });

  it('matches an origin only when it is written without a path', () => {
    expect(matchesUrl('https://cdn.example.com', url('https://cdn.example.com/a/b'))).toBe(true);
    expect(matchesUrl('https://cdn.example.com', url('http://cdn.example.com/a'))).toBe(false);
    expect(matchesUrl('https://cdn.example.com', url('https://cdn.example.com:8443/a'))).toBe(
      false,
    );
  });

  it('matches an address prefix', () => {
    expect(
      matchesUrl('https://cdn.example.com/lib/*', url('https://cdn.example.com/lib/a.js')),
    ).toBe(true);
    expect(
      matchesUrl('https://cdn.example.com/lib/*', url('https://cdn.example.com/other/a.js')),
    ).toBe(false);
    expect(
      matchesUrl('https://cdn.example.com/lib/', url('https://cdn.example.com/lib/a.js')),
    ).toBe(true);
  });

  it('tests a regular expression against the whole address, also a global one twice', () => {
    const pattern = /\.example\.com\/v\d+\//g;
    expect(matchesUrl(pattern, url('https://api.example.com/v2/users'))).toBe(true);
    expect(matchesUrl(pattern, url('https://api.example.com/v2/users'))).toBe(true);
    expect(matchesUrl(pattern, url('https://api.example.com/users'))).toBe(false);
  });

  it('accepts an entry with a reason', () => {
    expect(matchesUrl({ match: 'a.test', reason: 'why' }, url('https://a.test/'))).toBe(true);
  });
});

describe('matchesName', () => {
  it('matches exactly, with a wildcard and with a regular expression', () => {
    expect(matchesName('session', 'session')).toBe(true);
    expect(matchesName('session', 'session2')).toBe(false);
    expect(matchesName('_ga*', '_ga')).toBe(true);
    expect(matchesName('_ga*', '_ga_ABC123')).toBe(true);
    expect(matchesName('_ga*', 'x_ga')).toBe(false);
    expect(matchesName('a.b*', 'axb')).toBe(false);
    expect(matchesName(/^id-\d+$/, 'id-42')).toBe(true);
  });
});

describe('matchesText', () => {
  it('finds a piece of text or a pattern', () => {
    expect(matchesText('favicon', '404 http://x.test/favicon.ico')).toBe(true);
    expect(matchesText('nope', '404 http://x.test/favicon.ico')).toBe(false);
    expect(matchesText(/^404 /, '404 http://x.test/')).toBe(true);
  });
});

describe('reasonFor', () => {
  it('returns the reason of the first matching entry', () => {
    const entries = ['a.test', { match: 'b.test', reason: 'payments' }];
    expect(reasonFor(entries, (entry) => matchesUrl(entry, url('https://b.test/')))).toBe(
      'payments',
    );
    expect(
      reasonFor(entries, (entry) => matchesUrl(entry, url('https://a.test/'))),
    ).toBeUndefined();
  });
});
