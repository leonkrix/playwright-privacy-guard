import { expect, test } from '../src/index.js';
import { ofRule, open, subjects } from './helpers.js';

// The cookies of the test server are on a machine-local host, which is never asked to be Secure
test.use({ privacyGuard: { mode: 'report' } });

test.describe('the attributes of allowed cookies', () => {
  test.use({
    privacyGuard: {
      mode: 'report',
      allow: { cookies: ['session', 'theme', 'cross'] },
      cookieAttributes: { httpOnly: ['theme'], maxDays: 30 },
    },
  });

  test('a cookie that is allowed is still asked to be HttpOnly and not to live for a year', async ({
    page,
    privacy,
  }) => {
    await open(page, '/set-cookie.html');
    const found = await privacy.check();
    expect(ofRule(found, 'cookies')).toEqual([]);
    expect(subjects(found, 'cookieAttributes')).toEqual(['cookie theme']);
    const [theme] = ofRule(found, 'cookieAttributes');
    expect(theme?.level).toBe('warn');
    expect(theme?.summary).toContain('not HttpOnly');
    expect(theme?.details.join('\n')).toContain('lives for 365 days');
  });

  test('SameSite=None that a header asks for is found', async ({ page, privacy, browserName }) => {
    // Chromium refuses SameSite=None without Secure, and WebKit does not keep a Secure cookie that
    // comes over plain http, so there is no cookie to judge there (the rule judges kept cookies)
    test.skip(
      browserName === 'webkit',
      'WebKit does not keep a Secure cookie from http://localhost',
    );
    await open(page, '/samesite-none.html');
    const found = await privacy.check();
    expect(subjects(found, 'cookieAttributes')).toEqual(['cookie cross']);
    expect(ofRule(found, 'cookieAttributes')[0]?.summary).toContain('SameSite=None');
  });
});

test.describe('without the setting', () => {
  test.use({ privacyGuard: { mode: 'report', allow: { cookies: ['session', 'theme'] } } });

  test('is off until it is asked for', async ({ page, privacy }) => {
    await open(page, '/set-cookie.html');
    expect(await privacy.check()).toEqual([]);
  });
});
