import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { main } from '../src/cli.js';
import { OTHER } from './helpers.js';

/** Runs the command like a terminal would, and returns what it printed */
async function run(
  args: string[],
  browserName: string,
): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main([...args, '--browser', browserName, '--wait', '0', '--no-scroll'], {
    out: (text) => (out += text),
    err: (text) => (err += text),
  });
  return { code, out, err };
}

/** What the test server's third party does that is allowed in the tests below, with a reason */
const ALLOW_THIRD_PARTY = {
  requests: [{ match: new URL(OTHER).host, reason: 'the analytics of the test' }],
  cookies: [{ match: 'tracker', reason: 'it sets one with the answer' }],
};

/** Writes an options file in a folder of its own and hands it to the test */
async function withOptions(
  options: object,
  body: (file: string, folder: string) => Promise<void>,
): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), 'privacy-guard-cli-'));
  try {
    const file = join(folder, 'guard.json');
    await writeFile(file, JSON.stringify(options));
    await body(file, folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

test.describe('the command line', () => {
  test('a page that keeps to itself exits with 0', async ({ baseURL, browserName }) => {
    const { code, out } = await run(['scan', `${baseURL ?? ''}/clean.html`], browserName);
    expect(code).toBe(0);
    expect(out).toContain('nothing found');
    expect(out).toContain('1 page: 0 errors, 0 warnings');
  });

  test('a page that talks to another origin exits with 1 and says to whom', async ({
    baseURL,
    browserName,
  }) => {
    const { code, out } = await run(
      ['scan', `${baseURL ?? ''}/third-party-script.html`],
      browserName,
    );
    expect(code).toBe(1);
    expect(out).toContain('Requests to other origins (1)');
    expect(out).toContain(new URL(OTHER).host);
    expect(out).toContain('"allow": {');
  });

  test('--fail-on never lets it pass, --fail-on warn is stricter than the default', async ({
    baseURL,
    browserName,
  }) => {
    const address = `${baseURL ?? ''}/third-party-script.html`;
    expect((await run(['scan', address, '--fail-on', 'never'], browserName)).code).toBe(0);
    // With the third party allowed only a warning is left: a script without integrity
    await withOptions({ allow: ALLOW_THIRD_PARTY }, async (file) => {
      expect((await run(['scan', address, '--options', file], browserName)).code).toBe(0);
      expect(
        (await run(['scan', address, '--options', file, '--fail-on', 'warn'], browserName)).code,
      ).toBe(1);
    });
  });

  test('an options file allows what is meant, and the report says why', async ({
    baseURL,
    browserName,
  }) => {
    await withOptions({ allow: ALLOW_THIRD_PARTY, rules: { sri: 'off' } }, async (file) => {
      const { code, out } = await run(
        ['scan', `${baseURL ?? ''}/third-party-script.html`, '--options', file],
        browserName,
      );
      expect(code).toBe(0);
      expect(out).toContain('Allowed on purpose');
      expect(out).toContain('reason: the analytics of the test');
    });
  });

  test('the addresses can come from a file, and the report can go to a file as JSON', async ({
    baseURL,
    browserName,
  }) => {
    const folder = await mkdtemp(join(tmpdir(), 'privacy-guard-cli-'));
    try {
      const list = join(folder, 'urls.txt');
      const result = join(folder, 'nested', 'report.json');
      await writeFile(
        list,
        `# pages\n${baseURL ?? ''}/clean.html\n${baseURL ?? ''}/third-party-script.html # the leaky one\n`,
      );
      const { code, out, err } = await run(
        ['scan', '--file', list, '--format', 'json', '--out', result],
        browserName,
      );
      expect(code).toBe(1);
      expect(out).toBe('');
      expect(err).toContain('[2/2]');
      const report = JSON.parse(await readFile(result, 'utf8')) as {
        pages: { url: string; report: { counts: { errors: number } } }[];
      };
      expect(report.pages.map((page) => page.report.counts.errors > 0)).toEqual([false, true]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  test('a page that cannot be loaded exits with 2', async ({ browserName }) => {
    const { code, out } = await run(['scan', 'http://127.0.0.1:1/', '--timeout', '5'], browserName);
    expect(code).toBe(2);
    expect(out).toContain('could not be loaded');
  });

  test('a mistake in the command is told at once, without starting a browser', async () => {
    let err = '';
    const code = await main(['scan', 'example.com', '--format', 'xml'], {
      out: () => undefined,
      err: (text) => (err += text),
    });
    expect(code).toBe(2);
    expect(err).toContain('--format');
  });

  test('a wrong name in the options file is refused with the name', async ({
    baseURL,
    browserName,
  }) => {
    const folder = await mkdtemp(join(tmpdir(), 'privacy-guard-cli-'));
    try {
      const file = join(folder, 'guard.json');
      await writeFile(file, JSON.stringify({ allow: { requests: [], telepathy: [] } }));
      const { code, err } = await run(
        ['scan', `${baseURL ?? ''}/clean.html`, '--options', file],
        browserName,
      );
      expect(code).toBe(2);
      expect(err).toContain('telepathy');
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
