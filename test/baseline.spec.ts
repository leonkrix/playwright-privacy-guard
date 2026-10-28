import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '../src/index.js';
import { open } from './helpers.js';

// One folder per browser, so the three browsers never write the same file
const folder = (project: string): string => join('test-results', `baseline-${project}`);

test.describe('known findings', () => {
  test.describe.configure({ mode: 'serial' });
  const path = (project: string): string => join(folder(project), 'baseline.json');

  // The tests install their own guard, with a baseline: the one of the fixture stays out of the way
  test.use({ privacyGuard: false });

  test('are listed and do not fail the test', async ({ page, context }, testInfo) => {
    const file = path(testInfo.project.name);
    mkdirSync(folder(testInfo.project.name), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        findings: [
          { rule: 'requests', subject: 'localhost:4411', page: '/third-party-script.html' },
          { rule: 'cookies', subject: 'cookie tracker', page: '/third-party-script.html' },
        ],
      }),
    );
    const { installPrivacyGuard } = await import('../src/index.js');
    const privacy = await installPrivacyGuard(context, { baseline: file }, 'http://127.0.0.1:4410');
    await open(page, '/third-party-script.html');
    const report = await privacy.report();
    expect(report.findings).toEqual([]);
    expect(report.known.map((item) => item.subject).sort()).toEqual([
      'cookie tracker',
      'localhost:4411',
    ]);
    await privacy.assertClean();
  });

  test('a new finding still fails', async ({ page, context }, testInfo) => {
    const file = path(testInfo.project.name);
    const { installPrivacyGuard } = await import('../src/index.js');
    const privacy = await installPrivacyGuard(context, { baseline: file }, 'http://127.0.0.1:4410');
    await open(page, '/third-party-image.html');
    const report = await privacy.report();
    // The address of the page is new: the image is not in the baseline
    expect(report.findings.map((item) => item.subject)).toContain('localhost:4411');
    await expect(privacy.assertClean()).rejects.toThrow('Privacy guard');
  });

  test('the findings of a run can be written into a baseline', async ({
    page,
    context,
  }, testInfo) => {
    const file = path(testInfo.project.name);
    rmSync(file, { force: true });
    expect(existsSync(file)).toBe(false);
    const { addToBaseline } = await import('../src/baseline.js');
    const { installPrivacyGuard } = await import('../src/index.js');
    const privacy = await installPrivacyGuard(context, {}, 'http://127.0.0.1:4410');
    await open(page, '/set-cookie.html');
    addToBaseline(file, (await privacy.report()).findings);
    const written = JSON.parse(readFileSync(file, 'utf8')) as { findings: { subject: string }[] };
    expect(written.findings.map((item) => item.subject)).toEqual([
      'cookie session',
      'cookie theme',
    ]);
  });
});

test.describe('bad options', () => {
  test('an empty baseline path is refused', async ({ context }) => {
    const { installPrivacyGuard } = await import('../src/index.js');
    await expect(installPrivacyGuard(context, { baseline: ' ' })).rejects.toThrow(
      'baseline must be the path of a file',
    );
  });
});
