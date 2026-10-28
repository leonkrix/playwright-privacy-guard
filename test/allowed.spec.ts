import { expect, test } from '../src/index.js';
import { OTHER, ofRule, open } from './helpers.js';

// These tests look at what the guard finds; fixture.spec.ts proves that a finding stops a test
test.use({ privacyGuard: { mode: 'report' } });

test.describe('allowed on purpose', () => {
  test.use({
    privacyGuard: {
      mode: 'report',
      rules: { sri: 'off' },
      allow: {
        requests: [{ match: 'localhost:4411', reason: 'the test server of the other origin' }],
        cookies: [{ match: 'tracker', reason: 'set by that server' }],
      },
    },
  });

  test('the report lists what an entry let pass, with the reason', async ({ page, privacy }) => {
    await open(page, '/third-party-script.html');
    const report = await privacy.report();
    expect(report.findings).toEqual([]);
    const requests = report.allowed.find((use) => use.rule === 'requests');
    expect(requests).toMatchObject({
      what: 'localhost:4411',
      entry: 'localhost:4411',
      reason: 'the test server of the other origin',
      page: '/third-party-script.html',
    });
    expect(report.allowed.find((use) => use.rule === 'cookies')).toMatchObject({
      what: 'cookie tracker',
      reason: 'set by that server',
    });
  });

  test('nothing is listed when nothing happened', async ({ page, privacy }) => {
    await open(page, '/clean.html');
    expect((await privacy.report()).allowed).toEqual([]);
  });
});

test.describe('a reason for an api and a way of recognising a browser', () => {
  test.use({
    privacyGuard: {
      mode: 'report',
      rules: { fingerprint: 'warn' },
      allow: {
        apis: [{ match: 'geolocation', reason: 'the map asks where you are' }],
        fingerprint: [{ match: 'canvas', reason: 'the game draws on it' }, 'webgl'],
      },
    },
  });

  test('the report says why', async ({ page, privacy }) => {
    await open(page, '/apis.html');
    await open(page, '/fingerprint.html');
    const report = await privacy.report();
    expect(ofRule(report.findings, 'apis').map((found) => found.subject)).not.toContain(
      'API geolocation',
    );
    expect(report.allowed.find((use) => use.what === 'API geolocation')?.reason).toBe(
      'the map asks where you are',
    );
    expect(report.allowed.find((use) => use.what === 'fingerprinting: canvas')?.reason).toBe(
      'the game draws on it',
    );
  });
});

test('the other origin is what the test servers say it is', () => {
  expect(OTHER).toBe('http://localhost:4411');
});
