import { expect, test } from '../src/index.js';
import { ofRule, open, subjects } from './helpers.js';

test.describe('off by default', () => {
  test.use({ privacyGuard: { mode: 'report' } });

  test('a page that reads its canvas is left alone', async ({ page, privacy }) => {
    await open(page, '/fingerprint.html');
    expect(ofRule(await privacy.check(), 'fingerprint')).toEqual([]);
  });
});

test.describe('switched on', () => {
  test.use({ privacyGuard: { mode: 'report', rules: { fingerprint: 'warn' } } });

  test('finds the ways a page recognises a browser, as warnings', async ({ page, privacy }) => {
    await open(page, '/fingerprint.html');
    const found = ofRule(await privacy.check(), 'fingerprint');
    expect(found.every((item) => item.level === 'warn')).toBe(true);
    const names = subjects(found, 'fingerprint');
    expect(names).toContain('fingerprinting: canvas');
    expect(names).toContain('fingerprinting: fonts');
    const canvas = found.find((item) => item.subject === 'fingerprinting: canvas');
    expect(canvas?.source?.url).toContain('/fingerprint.js');
    expect(canvas?.allow).toEqual({ key: 'fingerprint', value: 'canvas' });
  });

  test.describe('allowed', () => {
    test.use({
      privacyGuard: {
        mode: 'report',
        rules: { fingerprint: 'warn' },
        allow: { fingerprint: ['canvas', 'webgl', 'audio', 'battery', 'fonts'] },
      },
    });

    test('by name', async ({ page, privacy }) => {
      await open(page, '/fingerprint.html');
      expect(ofRule(await privacy.check(), 'fingerprint')).toEqual([]);
    });
  });
});
