import { expect, test } from '../src/index.js';
import { ofRule, open, subjects } from './helpers.js';

test.describe('recommended headers', () => {
  test.use({ privacyGuard: { mode: 'report', headers: 'recommended' } });

  test('a page with good headers has no findings', async ({ page, privacy }) => {
    await open(page, '/headers-good.html');
    const found = await privacy.check();
    expect(ofRule(found, 'headers')).toEqual([]);
    expect(ofRule(found, 'cspQuality')).toEqual([]);
  });

  test('a page with few headers: what is missing and what leaks', async ({ page, privacy }) => {
    await open(page, '/headers-weak.html');
    const found = await privacy.check();
    expect(subjects(found, 'headers')).toEqual([
      'header referrer-policy',
      'header server',
      'header x-content-type-options',
      'header x-frame-options',
      'header x-powered-by',
    ]);
    const server = ofRule(found, 'headers').find((item) => item.subject === 'header server');
    expect(server?.summary).toContain('nginx/1.18.0');
  });

  test('a weak policy is a warning with the reason', async ({ page, privacy }) => {
    await open(page, '/headers-weak.html');
    const found = ofRule(await privacy.check(), 'cspQuality');
    expect(found.every((item) => item.level === 'warn')).toBe(true);
    expect(found.map((item) => item.subject).sort()).toEqual([
      'base-uri is missing',
      'frame-ancestors is missing',
      'object-src is not restricted',
      "script-src allows 'unsafe-eval'",
      "script-src allows 'unsafe-inline'",
      'script-src allows https:',
    ]);
  });

  test('a policy in a meta tag counts, and cannot have frame-ancestors', async ({
    page,
    privacy,
  }) => {
    await open(page, '/headers-meta.html');
    const found = await privacy.check();
    expect(subjects(found, 'headers')).not.toContain('header content-security-policy');
    expect(subjects(found, 'cspQuality')).toEqual([]);
  });

  test('a page without any header', async ({ page, privacy }) => {
    await open(page, '/clean.html');
    const found = subjects(await privacy.check(), 'headers');
    expect(found).toContain('header content-security-policy');
    expect(found).toContain('header x-content-type-options');
    // The page is http: nothing is said about Strict-Transport-Security
    expect(found).not.toContain('header strict-transport-security');
  });
});

test.describe('strict headers', () => {
  test.use({ privacyGuard: { mode: 'report', headers: 'strict' } });

  test('also asks for a permissions policy and an opener policy', async ({ page, privacy }) => {
    await open(page, '/headers-weak.html');
    const found = subjects(await privacy.check(), 'headers');
    expect(found).toContain('header permissions-policy');
    expect(found).toContain('header cross-origin-opener-policy');
  });

  test('a page with all of them is clean', async ({ page, privacy }) => {
    await open(page, '/headers-good.html');
    expect(ofRule(await privacy.check(), 'headers')).toEqual([]);
  });
});

test.describe('your own header rules', () => {
  test.use({
    privacyGuard: {
      mode: 'report',
      headers: {
        rules: {
          'x-powered-by': 'absent',
          'x-frame-options': 'DENY',
          'content-type': /^text\/html/,
          'referrer-policy': 'present',
          server: (value) => value === undefined || 'the server header must not be sent',
        },
      },
    },
  });

  test('each kind of rule', async ({ page, privacy }) => {
    await open(page, '/headers-weak.html');
    const found = ofRule(await privacy.check(), 'headers');
    expect(found.map((item) => `${item.subject}: ${item.summary}`).sort()).toEqual([
      'header referrer-policy: missing',
      'header server: the server header must not be sent',
      'header x-frame-options: missing (expected DENY)',
      'header x-powered-by: is set (Express) but must not be',
    ]);
  });
});

test.describe('rules', () => {
  test.use({
    privacyGuard: {
      mode: 'report',
      headers: 'recommended',
      rules: { headers: 'off', cspQuality: 'off' },
    },
  });

  test('can be switched off one by one', async ({ page, privacy }) => {
    await open(page, '/headers-weak.html');
    const found = await privacy.check();
    expect(ofRule(found, 'headers')).toEqual([]);
    expect(ofRule(found, 'cspQuality')).toEqual([]);
  });
});

test.describe('off by default', () => {
  test.use({ privacyGuard: { mode: 'report' } });

  test('nothing is said about headers when nobody asked', async ({ page, privacy }) => {
    await open(page, '/headers-weak.html');
    const found = await privacy.check();
    expect(ofRule(found, 'headers')).toEqual([]);
    expect(ofRule(found, 'cspQuality')).toEqual([]);
  });
});
