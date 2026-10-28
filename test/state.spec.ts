import { expect, test } from '../src/index.js';
import { ofRule, open, subjects } from './helpers.js';

test.use({ privacyGuard: { mode: 'report' } });

test.describe('cookies', () => {
  test('finds a cookie from a Set-Cookie header, with its attributes', async ({
    page,
    privacy,
  }) => {
    await open(page, '/set-cookie.html');
    const found = ofRule(await privacy.check(), 'cookies');
    expect(found.map((item) => item.subject).sort()).toEqual(['cookie session', 'cookie theme']);
    const session = found.find((item) => item.subject === 'cookie session');
    expect(session?.details.join('\n')).toContain('Set-Cookie header');
    expect(session?.details.join('\n')).toContain('HttpOnly');
    const theme = found.find((item) => item.subject === 'cookie theme');
    expect(theme?.details.join('\n')).toContain('expires in 365 days');
  });

  test('finds a cookie that a script sets, with the script', async ({ page, privacy }) => {
    await open(page, '/cookie-js.html');
    const [found] = ofRule(await privacy.check(), 'cookies');
    expect(found).toMatchObject({ subject: 'cookie visited' });
    expect(found?.source?.url).toContain('/cookie.js');
    expect(found?.details.join('\n')).toContain('document.cookie');
  });

  test('finds a cookie that was set and deleted again', async ({ page, privacy }) => {
    await open(page, '/cookie-removed.html');
    expect(subjects(await privacy.check(), 'cookies')).toEqual(['cookie temp']);
  });

  test('does not count a header that deletes a cookie', async ({ page, privacy }) => {
    await open(page, '/delete-cookie.html');
    expect(ofRule(await privacy.check(), 'cookies')).toEqual([]);
  });

  test('finds the cookie of a third party response and names the host', async ({
    page,
    privacy,
  }) => {
    await open(page, '/third-party-cookie.html');
    const found = ofRule(await privacy.check(), 'cookies');
    expect(found.map((item) => item.subject)).toEqual(['cookie tracker']);
    expect(found[0]?.details.join('\n')).toContain('localhost:4411');
  });

  test.describe('allowed', () => {
    test.use({
      privacyGuard: {
        mode: 'report',
        allow: { cookies: ['session', { match: 'th*', reason: 'the theme switch' }] },
      },
    });

    test('a name, a pattern and nothing else', async ({ page, privacy }) => {
      await open(page, '/set-cookie.html');
      expect(ofRule(await privacy.check(), 'cookies')).toEqual([]);
    });
  });

  test('a cookie that was there before the test is not the page', async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: 'http://127.0.0.1:4410',
      storageState: {
        cookies: [
          {
            name: 'login',
            value: 'x',
            domain: '127.0.0.1',
            path: '/',
            expires: -1,
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
          },
        ],
        origins: [],
      },
    });
    const { installPrivacyGuard } = await import('../src/index.js');
    const privacy = await installPrivacyGuard(context, { mode: 'report' });
    const page = await context.newPage();
    await open(page, '/clean.html');
    expect(await privacy.check()).toEqual([]);
    await context.close();
  });
});

test.describe('storage', () => {
  test('finds every kind of storage a script writes, with the script', async ({
    page,
    privacy,
  }) => {
    await open(page, '/storage.html');
    const found = ofRule(await privacy.check(), 'storage');
    expect(found.map((item) => item.subject).sort()).toEqual([
      'Cache Storage cache "app-cache"',
      'IndexedDB database "app-db"',
      'localStorage "theme"',
      'sessionStorage "step"',
    ]);
    const theme = found.find((item) => item.subject === 'localStorage "theme"');
    expect(theme?.source?.url).toContain('/storage.js');
    expect(theme?.allow).toEqual({ key: 'localStorage', value: 'theme' });
  });

  test('finds a write that does not call setItem, in the state at the end', async ({
    page,
    privacy,
  }) => {
    await open(page, '/storage-direct.html');
    expect(subjects(await privacy.check(), 'storage')).toEqual([
      'localStorage "direct"',
      'sessionStorage "also-direct"',
    ]);
  });

  test('finds a service worker', async ({ page, privacy }) => {
    await open(page, '/service-worker.html');
    await page.waitForFunction(
      async () => (await navigator.serviceWorker.getRegistrations()).length > 0,
    );
    const found = ofRule(await privacy.check(), 'storage');
    expect(found.map((item) => item.subject)).toEqual([
      'service worker "http://127.0.0.1:4410/sw.js"',
    ]);
    expect(found[0]?.allow).toEqual({ key: 'serviceWorkers', value: 'true' });
  });

  test.describe('allowed', () => {
    test.use({
      privacyGuard: {
        mode: 'report',
        allow: { localStorage: ['theme'], sessionStorage: ['*'], indexedDB: ['app-*'] },
      },
    });

    test('by key, by wildcard, by prefix', async ({ page, privacy }) => {
      await open(page, '/storage.html');
      expect(subjects(await privacy.check(), 'storage')).toEqual([
        'Cache Storage cache "app-cache"',
      ]);
    });
  });

  test('finds the storage of a frame from another origin', async ({ page, privacy }) => {
    await page.route('http://localhost:4411/frame-content.html', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<script>localStorage.setItem("widget", "1")</script>',
      }),
    );
    await open(page, '/frame.html');
    const found = ofRule(await privacy.check(), 'storage');
    expect(found.map((item) => item.subject)).toEqual(['localStorage "widget"']);
    expect(found[0]?.details.join('\n')).toContain('http://localhost:4411');
  });
});
