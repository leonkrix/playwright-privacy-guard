import { test as base } from '@playwright/test';

import { addToBaseline } from './baseline.js';
import { formatFindings } from './format.js';
import { installPrivacyGuard, type PrivacyGuard } from './install.js';
import { resolveOptions } from './options.js';
import { renderHtml } from './report-html.js';
import type { PrivacyGuardOptions, PrivacyGuardTestOptions } from './types.js';

export interface PrivacyGuardFixtures extends PrivacyGuardTestOptions {
  /** The guard of this test, to allow more for a part of it or to look at what it found */
  privacy: PrivacyGuard;
}

const off: PrivacyGuard = {
  findings: [],
  check: () => Promise.resolve([]),
  assertClean: () => Promise.resolve(),
  allow: () => undefined,
  forget: () => Promise.resolve(),
  report: () =>
    Promise.resolve({
      version: 1,
      generatedAt: new Date().toISOString(),
      mode: 'enforce',
      findings: [],
      known: [],
      counts: { errors: 0, warnings: 0 },
      pages: [],
      observations: 0,
      dropped: 0,
    }),
};

/** Set by the person who wants the baseline file written instead of the test failed. */
const updating = (): boolean => ['1', 'true'].includes(process.env.PRIVACY_GUARD_UPDATE ?? '');

/**
 * Playwright's `test`, with the guard switched on for every test: when the test ends and the page
 * talked to another origin, set a cookie, stored something on the device, broke its Content Security
 * Policy or logged an error, the test fails and says what, where it came from and how to allow it.
 */
export const test = base.extend<PrivacyGuardFixtures>({
  privacyGuard: [true, { option: true }],
  privacy: [
    // `page` is a dependency on purpose: the guard has to look at the storage of the pages
    // before they are closed, so the page must still be there when this fixture ends
    async ({ context, privacyGuard, baseURL, page: _page }, use, testInfo) => {
      if (privacyGuard === false) {
        await use(off);
        return;
      }
      const options: PrivacyGuardOptions = privacyGuard === true ? {} : privacyGuard;
      const guard = await installPrivacyGuard(context, options, baseURL);
      await use(guard);
      const report = await guard.report();
      if (report.findings.length === 0 && report.known.length === 0) {
        return;
      }
      const resolved = resolveOptions(options);
      if (resolved.baseline !== undefined && updating()) {
        // Recording what is there today: nothing fails
        addToBaseline(resolved.baseline, [...report.findings, ...report.known]);
        return;
      }
      await testInfo.attach('privacy-report.json', {
        body: JSON.stringify(report, null, 2),
        contentType: 'application/json',
      });
      await testInfo.attach('privacy-report.html', {
        body: renderHtml(report, `Privacy guard: ${testInfo.title}`),
        contentType: 'text/html',
      });
      const text = formatFindings(report.findings);
      await testInfo.attach('privacy-report.txt', { body: text, contentType: 'text/plain' });
      for (const found of report.findings.filter((item) => item.level === 'warn')) {
        testInfo.annotations.push({
          type: 'privacy-guard warning',
          description: `${found.subject}: ${found.summary}`,
        });
      }
      const enforce = resolved.mode === 'enforce';
      // A test that already failed says why; a second error would only hide it
      if (enforce && report.counts.errors > 0 && testInfo.errors.length === 0) {
        throw new Error(text);
      }
    },
    { auto: true },
  ],
});
