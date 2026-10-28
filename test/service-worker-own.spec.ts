import { expect, test } from '@playwright/test';

import { installPrivacyGuard } from '../src/index.js';
import { ofRule } from './helpers.js';

// The package is used here without the fixture and without a baseURL, the way a script uses it
test('the service worker of the site itself is not a third party', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  try {
    const guard = await installPrivacyGuard(context, { mode: 'report' });
    const page = await context.newPage();
    await page.goto(`${baseURL ?? ''}/service-worker.html`);
    await page.waitForFunction(
      async () => (await navigator.serviceWorker.getRegistrations()).length > 0,
    );
    await page.waitForLoadState('networkidle');
    expect(ofRule(await guard.check(), 'requests')).toEqual([]);
  } finally {
    await context.close();
  }
});
