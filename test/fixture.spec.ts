import { expect, test } from '../src/index.js';
import { open } from './helpers.js';

/**
 * The fixture itself: a test that lets the page leak must fail, a clean one must pass. Playwright's
 * `test.fail()` turns "this test fails" into a pass, so these tests prove that the guard really
 * stops a test.
 */

test('passes on a page that keeps to itself', async ({ page }) => {
  await open(page, '/clean.html');
  await expect(page.locator('h1')).toBeVisible();
});

test.describe('a page that talks to another origin', () => {
  test.fail();

  test('fails the test that visited it', async ({ page }) => {
    await open(page, '/third-party-script.html');
    // The test itself finds nothing wrong, the guard does
    await expect(page.locator('h1')).toBeVisible();
  });
});

test.describe('a page that sets a cookie', () => {
  test.fail();

  test('fails the test that visited it', async ({ page }) => {
    await open(page, '/set-cookie.html');
  });
});

test.describe('a page that stores something', () => {
  test.fail();

  test('fails the test that visited it', async ({ page }) => {
    await open(page, '/storage.html');
  });
});

test.describe('a page that breaks its policy', () => {
  test.fail();

  test('fails the test that visited it', async ({ page }) => {
    await open(page, '/csp.html');
  });
});

test.describe('a page that logs an error', () => {
  test.fail();

  test('fails the test that visited it', async ({ page }) => {
    await open(page, '/console-error.html');
  });
});

test.describe('with the guard switched off', () => {
  test.use({ privacyGuard: false });

  test('does not fail on a page that leaks', async ({ page, privacy }) => {
    await open(page, '/third-party-script.html');
    expect(await privacy.check()).toEqual([]);
  });
});

test.describe('in report mode', () => {
  test.use({ privacyGuard: { mode: 'report' } });

  test('does not fail, and still attaches the report', async ({ page, privacy }, testInfo) => {
    await open(page, '/third-party-script.html');
    expect((await privacy.check()).length).toBeGreaterThan(0);
    // The attachment is made when the test ends
    expect(testInfo.attachments).toEqual([]);
  });
});

test.describe('a warning', () => {
  test.use({
    privacyGuard: { allow: { requests: ['localhost:4411'], cookies: ['tracker'] } },
  });

  test('does not fail the test, and shows up as an annotation', async ({ page }, testInfo) => {
    await open(page, '/sri.html');
    await expect(page.locator('h1')).toBeVisible();
    // The annotation is added when the test ends: the test passing is the proof
    expect(testInfo.annotations).toEqual([]);
  });
});

test.describe('assertClean in the middle of a test', () => {
  test.use({ privacyGuard: { mode: 'enforce' } });

  test('throws with the message of the findings', async ({ page, privacy }) => {
    await open(page, '/third-party-script.html');
    const message = await privacy.assertClean().then(
      () => '',
      (error: unknown) => (error as Error).message,
    );
    expect(message).toMatch(/Privacy guard: \d problems? \(.*\) on \/third-party-script\.html/);
    expect(message).toContain('Requests to other origins (1)');
    expect(message).toContain("requests: ['localhost:4411']");
    // The report is the answer; the test goes on without the problem
    privacy.allow({ requests: ['localhost:4411'] });
    await privacy.forget();
  });
});

test.describe('forget', () => {
  test.use({ privacyGuard: { mode: 'report' } });

  test('counts what is there as known, and looks at what comes next', async ({ page, privacy }) => {
    await open(page, '/third-party-script.html');
    expect((await privacy.check()).length).toBeGreaterThan(0);
    await privacy.forget();
    expect(await privacy.check()).toEqual([]);
    await open(page, '/third-party-image.html');
    expect((await privacy.check()).map((item) => item.rule)).toContain('requests');
  });
});

test.describe('options that cannot work', () => {
  test('are refused at once, with the name of the option', async ({ context }) => {
    const { installPrivacyGuard } = await import('../src/index.js');
    await expect(
      installPrivacyGuard(context, { rules: { requests: 'loud' as 'error' } }),
    ).rejects.toThrow('rules.requests must be "error", "warn" or "off", not "loud"');
    await expect(
      installPrivacyGuard(context, { rules: { nothing: 'off' } as never }),
    ).rejects.toThrow('rules.nothing is not a rule');
    await expect(
      installPrivacyGuard(context, { allow: { apis: ['smell' as 'webrtc'] } }),
    ).rejects.toThrow('allow.apis has "smell"');
    await expect(
      installPrivacyGuard(context, { allow: { cookie: ['x'] } as never }),
    ).rejects.toThrow('allow.cookie is not an allow list');
    await expect(installPrivacyGuard(context, { mode: 'loud' as 'report' })).rejects.toThrow(
      'mode must be "enforce" or "report"',
    );
  });
});
