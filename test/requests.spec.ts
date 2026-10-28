import { expect, test } from '../src/index.js';
import { OTHER, ofRule, open, subjects } from './helpers.js';

// These tests look at what the guard finds (report mode never fails); fixture.spec.ts proves that a
// finding really stops a test
test.use({ privacyGuard: { mode: 'report' } });

test('a page that stays on its own origin has no findings', async ({ page, privacy }) => {
  await open(page, '/clean.html');
  expect(await privacy.check()).toEqual([]);
});

test('finds a script from another origin, with who runs it', async ({ page, privacy }) => {
  await open(page, '/third-party-script.html');
  const [found, ...others] = ofRule(await privacy.check(), 'requests');
  expect(others).toEqual([]);
  expect(found).toMatchObject({
    subject: 'localhost:4411',
    level: 'error',
    count: 1,
    page: '/third-party-script.html',
    allow: { key: 'requests', value: 'localhost:4411' },
  });
  expect(found?.details.join('\n')).toContain('script');
  expect(found?.details.join('\n')).toContain(`${OTHER}/analytics.js`);
});

test('finds an image, a fetch, a beacon and a web socket', async ({ page, privacy }) => {
  await open(page, '/third-party-image.html');
  await open(page, '/third-party-fetch.html');
  const [found] = ofRule(await privacy.check(), 'requests');
  expect(found?.count).toBeGreaterThanOrEqual(4);
  const kinds = found?.details[0] ?? '';
  expect(kinds).toContain('image');
  expect(kinds).toContain('fetch');
  expect(kinds).toMatch(/ping|beacon/);
  expect(kinds).toContain('websocket');
});

test('finds a request made by a worker', async ({ page, privacy }) => {
  await open(page, '/third-party-worker.html');
  await page.waitForTimeout(300);
  const found = ofRule(await privacy.check(), 'requests');
  expect(found.map((item) => item.subject)).toEqual(['localhost:4411']);
  expect(found[0]?.details.join('\n')).toContain('from-worker');
});

test('finds link hints that make the browser connect before anything is asked', async ({
  page,
  privacy,
}) => {
  await open(page, '/hints.html');
  const [found] = ofRule(await privacy.check(), 'requests');
  expect(found).toMatchObject({ subject: 'localhost:4411', count: 2 });
  expect(found?.summary).toContain('hint');
  expect(found?.details[0]).toContain('link rel=preconnect');
});

test('does not call a navigation to another origin a leak', async ({ page, privacy }) => {
  await open(page, '/clean.html');
  await page.goto(`${OTHER}/page.txt`);
  expect(ofRule(await privacy.check(), 'requests')).toEqual([]);
});

test('finds a request without encryption, not a local one', async ({ page, privacy }) => {
  await open(page, '/insecure.html');
  expect(subjects(await privacy.check(), 'insecure')).toEqual(['insecure.example.test']);
});

test.describe('allowing', () => {
  test.use({ privacyGuard: { mode: 'report', allow: { requests: ['localhost:4411'] } } });

  test('an allowed host is not reported', async ({ page, privacy }) => {
    await open(page, '/third-party-script.html');
    expect(ofRule(await privacy.check(), 'requests')).toEqual([]);
  });
});

test.describe('allowing with patterns', () => {
  test.use({
    privacyGuard: {
      mode: 'report',
      allow: { requests: [{ match: /localhost:4411\/.*\.js$/, reason: 'our script host' }] },
    },
  });

  test('a regular expression allows what it matches, and only that', async ({ page, privacy }) => {
    await open(page, '/third-party-script.html');
    await open(page, '/third-party-image.html');
    const found = ofRule(await privacy.check(), 'requests');
    expect(found).toHaveLength(1);
    expect(found[0]?.details.join('\n')).toContain('pixel.gif');
  });
});

test.describe('first party', () => {
  test.use({ privacyGuard: { mode: 'report', firstParty: ['localhost:4411'] } });

  test('an origin that counts as your own is not reported', async ({ page, privacy }) => {
    await open(page, '/third-party-script.html');
    expect(ofRule(await privacy.check(), 'requests')).toEqual([]);
  });
});

test.describe('allow over time', () => {
  test('a host allowed in the middle of a test is only allowed from then on', async ({
    page,
    privacy,
  }) => {
    await open(page, '/consent.html');
    expect(ofRule(await privacy.check(), 'requests')).toEqual([]);
    privacy.allow({ requests: ['localhost:4411'] });
    await page.getByRole('button', { name: 'Accept' }).click();
    await page.waitForLoadState('networkidle');
    expect(ofRule(await privacy.check(), 'requests')).toEqual([]);
  });

  test('without it the request after the click is found', async ({ page, privacy }) => {
    await open(page, '/consent.html');
    await page.getByRole('button', { name: 'Accept' }).click();
    await page.waitForLoadState('networkidle');
    expect(subjects(await privacy.check(), 'requests')).toEqual(['localhost:4411']);
  });
});

test('names the company behind a known host', async ({ page, privacy }) => {
  await page.route('https://www.google-analytics.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
  );
  await page.goto('/clean.html');
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.src = 'https://www.google-analytics.com/analytics.js';
    document.head.append(script);
  });
  await page.waitForLoadState('networkidle');
  const [found] = ofRule(await privacy.check(), 'requests');
  expect(found?.subject).toBe('www.google-analytics.com');
  expect(found?.tracker).toMatchObject({ category: 'analytics' });
  expect(found?.tracker?.entity).toMatch(/Google/);
});
