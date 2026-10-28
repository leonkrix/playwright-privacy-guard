import { expect, test } from '../src/index.js';
import { ofRule, open, subjects } from './helpers.js';

test.use({ privacyGuard: { mode: 'report' } });

test.describe('csp', () => {
  test('finds what the policy of the page blocks', async ({ page, privacy }) => {
    await open(page, '/csp.html');
    const found = ofRule(await privacy.check(), 'csp');
    expect(found.map((item) => item.subject).sort()).toEqual([
      'img-src: http://localhost:4411/pixel.gif',
      'script-src-elem: inline',
    ]);
    const image = found.find((item) => item.subject.startsWith('img-src'));
    expect(image?.summary).toContain('blocked http://localhost:4411/pixel.gif');
    expect(image?.allow).toEqual({ key: 'csp', value: 'img-src http://localhost:4411/pixel.gif' });
  });

  test('says when a policy only reports', async ({ page, privacy }) => {
    await open(page, '/csp-report-only.html');
    const [found] = ofRule(await privacy.check(), 'csp');
    expect(found?.summary).toContain('would block');
    expect(found?.details.join('\n')).toContain('Report-Only');
  });

  test('does not repeat a violation as a console error', async ({ page, privacy }) => {
    await open(page, '/csp.html');
    expect(ofRule(await privacy.check(), 'errors')).toEqual([]);
  });

  test.describe('allowed', () => {
    test.use({
      privacyGuard: {
        mode: 'report',
        allow: { csp: [/^script-src/, 'img-src http://localhost:4411'] },
      },
    });

    test('by directive and by address', async ({ page, privacy }) => {
      await open(page, '/csp.html');
      expect(ofRule(await privacy.check(), 'csp')).toEqual([]);
    });
  });
});

test.describe('errors', () => {
  test('finds a console error', async ({ page, privacy }) => {
    await open(page, '/console-error.html');
    const [found] = ofRule(await privacy.check(), 'errors');
    expect(found).toMatchObject({
      subject: 'console error',
      summary: 'Something went wrong in the app',
    });
  });

  test('finds an uncaught exception', async ({ page, privacy }) => {
    await open(page, '/exception.html');
    await page.waitForTimeout(100);
    const [found] = ofRule(await privacy.check(), 'errors');
    expect(found).toMatchObject({
      subject: 'uncaught exception',
      summary: expect.stringContaining('boom'),
    });
  });

  test('finds an HTTP error once, with its address', async ({ page, privacy }) => {
    await open(page, '/missing-image.html');
    const found = ofRule(await privacy.check(), 'errors');
    expect(found.map((item) => item.subject)).toEqual(['HTTP 404']);
    expect(found[0]?.details.join('\n')).toContain('/does-not-exist.png');
  });

  test('finds a request that fails', async ({ page, privacy }) => {
    await page.route('**/closed', (route) => route.abort('connectionfailed'));
    await open(page, '/failed-request.html');
    const found = ofRule(await privacy.check(), 'errors');
    expect(found.map((item) => item.subject)).toEqual(['failed request']);
  });

  test.describe('allowed', () => {
    test.use({
      privacyGuard: {
        mode: 'report',
        allow: { errors: [/^404 .*\/does-not-exist\.png$/, 'Something went wrong'] },
      },
    });

    test('by a pattern for the status and address, and by a piece of text', async ({
      page,
      privacy,
    }) => {
      await open(page, '/missing-image.html');
      await open(page, '/console-error.html');
      expect(ofRule(await privacy.check(), 'errors')).toEqual([]);
    });
  });

  test('a page that answers 404 on purpose can be allowed', async ({ page, privacy }) => {
    privacy.allow({ errors: [/^404 http:\/\/127\.0\.0\.1:4410\/status\/404$/] });
    await page.goto('/status/404');
    expect(ofRule(await privacy.check(), 'errors')).toEqual([]);
  });
});

test.describe('apis', () => {
  test('finds the sensitive APIs a page uses', async ({ page, privacy }) => {
    await open(page, '/apis.html');
    const found = subjects(await privacy.check(), 'apis');
    expect(found).toContain('API geolocation');
    expect(found).toContain('API notifications');
    // Not every browser build has WebRTC and a camera API
    const has = await page.evaluate(() => ({
      webrtc: typeof RTCPeerConnection !== 'undefined',
      media: typeof navigator.mediaDevices !== 'undefined',
    }));
    expect(found.includes('API webrtc')).toBe(has.webrtc);
    expect(found.includes('API camera-or-microphone')).toBe(has.media);
  });

  test.describe('allowed', () => {
    test.use({
      privacyGuard: {
        mode: 'report',
        allow: { apis: ['geolocation', 'notifications', 'webrtc', 'camera-or-microphone'] },
      },
    });

    test('by name', async ({ page, privacy }) => {
      await open(page, '/apis.html');
      expect(ofRule(await privacy.check(), 'apis')).toEqual([]);
    });
  });
});

test.describe('forms', () => {
  test('finds a form that sends to another origin', async ({ page, privacy }) => {
    await open(page, '/form.html');
    const found = ofRule(await privacy.check(), 'forms');
    expect(found.map((item) => item.subject)).toEqual(['form (post) to localhost:4411']);
  });

  test('finds a link that pings another origin', async ({ page, privacy }) => {
    await open(page, '/ping.html');
    expect(subjects(await privacy.check(), 'forms')).toEqual([
      'link with a ping attribute to localhost:4411',
    ]);
  });

  test('does not mind a form to the own origin', async ({ page, privacy }) => {
    await open(page, '/form-same.html');
    expect(ofRule(await privacy.check(), 'forms')).toEqual([]);
  });
});

test.describe('integrity and referrer of an allowed third party', () => {
  test.use({ privacyGuard: { mode: 'report', allow: { requests: ['localhost:4411'] } } });

  test('a script without integrity is a warning', async ({ page, privacy }) => {
    await open(page, '/sri.html');
    const [found] = ofRule(await privacy.check(), 'sri');
    expect(found).toMatchObject({ level: 'warn', subject: 'script from localhost:4411' });
  });

  test('a script with integrity is fine', async ({ page, privacy }) => {
    await open(page, '/sri-ok.html');
    expect(ofRule(await privacy.check(), 'sri')).toEqual([]);
  });

  test('a third party that gets the full address of the page is a warning', async ({
    page,
    privacy,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'Firefox and WebKit send only the origin across sites');
    await open(page, '/referrer.html');
    const [found] = ofRule(await privacy.check(), 'referrer');
    expect(found).toMatchObject({ level: 'warn', subject: 'localhost:4411' });
    expect(found?.details[0]).toContain('/referrer.html');
  });

  test('the default policy sends the origin only, which is fine', async ({ page, privacy }) => {
    await open(page, '/third-party-fetch.html');
    expect(ofRule(await privacy.check(), 'referrer')).toEqual([]);
  });
});

test.describe('leaks', () => {
  test.use({
    privacyGuard: {
      mode: 'report',
      allow: { requests: ['localhost:4411'] },
      watch: ['jane@example.com', /Jane Doe/],
    },
  });

  test('a watched value in the address of a request to a third party', async ({
    page,
    privacy,
  }) => {
    await open(page, '/leak.html');
    const [found] = ofRule(await privacy.check(), 'leaks');
    expect(found).toMatchObject({ level: 'error', subject: 'jane@example.com to localhost:4411' });
    expect(found?.details[0]).toContain('the address');
  });

  test('a watched value in the body', async ({ page, privacy }) => {
    await open(page, '/leak-body.html');
    const [found] = ofRule(await privacy.check(), 'leaks');
    expect(found?.details[0]).toContain('the body');
  });

  test('a page without the value is clean', async ({ page, privacy }) => {
    await open(page, '/third-party-fetch.html');
    expect(ofRule(await privacy.check(), 'leaks')).toEqual([]);
  });
});
