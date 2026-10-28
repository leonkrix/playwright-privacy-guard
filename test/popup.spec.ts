import { expect, test } from '../src/index.js';
import { ofRule, open } from './helpers.js';

// A link that opens another website in a new tab is the page leaving the site. What the other
// website does (its request, its cookie) is not a leak of the page under test.
test.use({ privacyGuard: { mode: 'report' } });

test('another website in a new tab is not a finding, its cookie neither', async ({
  page,
  privacy,
}) => {
  await open(page, '/popup-out.html');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#out').click()]);
  await popup.waitForLoadState('networkidle');
  expect(popup.url()).toContain('localhost:4411');
  expect(await page.context().cookies('http://localhost:4411')).not.toEqual([]);
  expect(await privacy.check()).toEqual([]);
});

test('the page that opened the tab is still judged', async ({ page, privacy }) => {
  await open(page, '/third-party-script.html');
  await open(page, '/popup-out.html');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#out').click()]);
  await popup.waitForLoadState('networkidle');
  // The script of the first page is still found; the tab adds nothing
  const found = await privacy.check();
  expect(ofRule(found, 'requests')).toHaveLength(1);
  expect(ofRule(found, 'cookies').map((item) => item.subject)).toEqual(['cookie tracker']);
});

test('a new tab on the same site is judged like any page', async ({ page, privacy }) => {
  await open(page, '/popup-own.html');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#own').click()]);
  await popup.waitForLoadState('networkidle');
  const found = await privacy.check();
  expect(ofRule(found, 'requests').map((item) => item.subject)).toEqual(['localhost:4411']);
});
