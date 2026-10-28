import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aggregate, renderMarkdown, renderSiteHtml } from './aggregate.js';
import { addToBaseline, keyOf, readBaseline, splitByBaseline } from './baseline.js';
import { allowHint, formatFindings } from './format.js';
import { escapeHtml, renderHtml } from './report-html.js';
import PrivacyReporter from './reporter.js';
import type { Finding } from './types.js';

const request = (subject: string, page: string, extra: Partial<Finding> = {}): Finding => ({
  rule: 'requests',
  level: 'error',
  subject,
  summary: `1 request to ${subject}`,
  details: [`first: https://${subject}/a.js`],
  count: 1,
  page,
  allow: { key: 'requests', value: subject },
  at: 10,
  ...extra,
});

describe('formatFindings', () => {
  it('says that nothing was found', () => {
    expect(formatFindings([])).toBe('Privacy guard: nothing found.');
  });

  it('groups by rule, names the tracker, and ends with what to allow', () => {
    const text = formatFindings([
      request('www.google-analytics.com', '/', {
        tracker: { entity: 'Google Analytics', category: 'analytics' },
        count: 3,
      }),
      request('fonts.gstatic.com', '/about', { level: 'warn' }),
      {
        rule: 'cookies',
        level: 'error',
        subject: 'cookie _ga',
        summary: 'cookie "_ga" is set by the page',
        details: [],
        count: 1,
        page: '/',
        allow: { key: 'cookies', value: '_ga' },
        at: 0,
      },
    ]);
    expect(text).toContain('Privacy guard: 3 problems (2 errors, 1 warning) on /, /about');
    expect(text).toContain('Requests to other origins (2)');
    expect(text).toContain('- www.google-analytics.com  [Google Analytics, analytics]');
    expect(text).toContain('- (warning) fonts.gstatic.com');
    expect(text).toContain('Cookies (1)');
    expect(text).toContain("requests: ['www.google-analytics.com', 'fonts.gstatic.com'],");
    expect(text).toContain("cookies: ['_ga'],");
  });

  it('quotes a value that has a quote in it', () => {
    const hint = allowHint([
      request("it's.test", '/', { allow: { key: 'requests', value: "it's.test" } }),
    ]);
    expect(hint.join('\n')).toContain("'it\\'s.test'");
  });

  it('writes the service worker flag as true', () => {
    const hint = allowHint([
      request('service worker', '/', { allow: { key: 'serviceWorkers', value: 'true' } }),
    ]);
    expect(hint.join('\n')).toContain('serviceWorkers: true,');
  });
});

describe('renderHtml', () => {
  it('escapes everything that comes from the page', () => {
    const html = renderHtml({
      generatedAt: 'now',
      mode: 'enforce',
      findings: [
        request('<img src=x onerror=alert(1)>', '/a"b', { details: ['<script>x</script>'] }),
      ],
      counts: { errors: 1, warnings: 0 },
      pages: ['/a"b'],
      dropped: 0,
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('/a&quot;b');
  });

  it('has no script and no external resource', () => {
    const html = renderHtml({
      generatedAt: 'now',
      mode: 'report',
      findings: [request('a.test', '/')],
      known: [request('b.test', '/')],
      counts: { errors: 1, warnings: 0 },
      pages: ['/'],
      dropped: 3,
    });
    expect(html).not.toMatch(/<script|<link| src=|@import|url\(/);
    expect(html).toContain('known (baseline)');
    expect(html).toContain('3 observations were not kept');
  });

  it('escapes the five characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});

describe('aggregate', () => {
  const entries = [
    {
      test: 'chromium › a',
      report: { findings: [request('x.test', '/'), request('y.test', '/', { level: 'warn' })] },
    },
    {
      test: 'chromium › b',
      report: { findings: [request('x.test', '/about')], known: [request('z.test', '/')] },
    },
    { test: 'chromium › c', report: { findings: [] } },
  ];

  it('puts the same problem on many pages into one row', () => {
    const result = aggregate(entries, 5);
    expect(result).toMatchObject({
      tests: 5,
      testsWithFindings: 2,
      errors: 1,
      warnings: 1,
      known: 1,
    });
    expect(result.rows.map((row) => `${row.level} ${row.subject}`)).toEqual([
      'error x.test',
      'warn y.test',
    ]);
    expect(result.rows[0]).toMatchObject({ pages: ['/', '/about'], count: 2 });
    expect(result.rows[0]?.tests).toEqual(['chromium › a', 'chromium › b']);
  });

  it('writes a Markdown table, and says when all is well', () => {
    expect(renderMarkdown(aggregate(entries, 5))).toContain(
      '| error | Requests to other origins | x.test |',
    );
    expect(renderMarkdown(aggregate([], 7))).toContain('No findings in 7 tests.');
  });

  it('writes a page', () => {
    expect(renderSiteHtml(aggregate(entries, 5))).toContain('<td>x.test</td>');
    expect(renderSiteHtml(aggregate([], 5))).toContain('Nothing found');
  });

  it('keeps a pipe in a cell from breaking the table', () => {
    const result = aggregate([{ test: 't', report: { findings: [request('a|b', '/')] } }], 1);
    expect(renderMarkdown(result)).toContain('a\\|b');
  });
});

describe('baseline', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'privacy-guard-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('has no entries when the file is not there', () => {
    expect(readBaseline(join(directory, 'none.json'))).toEqual([]);
  });

  it('writes sorted entries without the details, and adds to what is there', () => {
    const path = join(directory, 'sub', 'baseline.json');
    addToBaseline(path, [request('b.test', '/'), request('a.test', '/')]);
    addToBaseline(path, [request('a.test', '/'), request('c.test', '/x')]);
    const entries = readBaseline(path);
    expect(entries.map((entry) => entry.subject)).toEqual(['a.test', 'b.test', 'c.test']);
    expect(Object.keys(entries[0] ?? {})).toEqual(['rule', 'subject', 'page']);
    expect(readFileSync(path, 'utf8').endsWith('}\n')).toBe(true);
  });

  it('splits findings into known and new', () => {
    const path = join(directory, 'baseline.json');
    addToBaseline(path, [request('a.test', '/')]);
    const { known, fresh } = splitByBaseline(
      [request('a.test', '/'), request('a.test', '/other'), request('b.test', '/')],
      path,
    );
    expect(known.map(keyOf)).toEqual([keyOf(request('a.test', '/'))]);
    expect(fresh).toHaveLength(2);
    expect(splitByBaseline([request('a.test', '/')], undefined).fresh).toHaveLength(1);
  });

  it('refuses a file that is not a baseline', () => {
    const path = join(directory, 'bad.json');
    writeFileSync(path, '{ nope');
    expect(() => readBaseline(path)).toThrow('is not valid JSON');
    writeFileSync(path, '{"version":1}');
    expect(() => readBaseline(path)).toThrow('has no "findings" list');
  });
});

describe('PrivacyReporter', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'privacy-guard-'));
    // A run on GitHub has this set: no test may write into the summary of the real run
    vi.stubEnv('GITHUB_STEP_SUMMARY', '');
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const testCase = (title: string) =>
    ({
      titlePath: () => ['', 'chromium', 'file.spec.ts', title],
      parent: { project: () => ({ name: 'chromium' }) },
    }) as never;
  const result = (findings: Finding[]) =>
    ({
      attachments:
        findings.length === 0
          ? []
          : [
              {
                name: 'privacy-report.json',
                contentType: 'application/json',
                body: Buffer.from(JSON.stringify({ findings })),
              },
            ],
    }) as never;

  it('writes the page, the table and the numbers for the whole run', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const reporter = new PrivacyReporter({ outputDir: join(directory, 'out') });
    reporter.onTestEnd(testCase('one'), result([request('x.test', '/')]));
    reporter.onTestEnd(testCase('two'), result([]));
    reporter.onEnd({ status: 'passed' } as never);
    expect(existsSync(join(directory, 'out', 'index.html'))).toBe(true);
    expect(readFileSync(join(directory, 'out', 'summary.md'), 'utf8')).toContain('x.test');
    const summary = JSON.parse(readFileSync(join(directory, 'out', 'summary.json'), 'utf8')) as {
      tests: number;
      rows: { example?: unknown }[];
    };
    expect(summary.tests).toBe(2);
    expect(summary.rows[0]?.example).toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('1 errors and 0 warnings in 1 of 2 tests'),
    );
  });

  it('writes nothing when nothing was found', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const reporter = new PrivacyReporter({ outputDir: join(directory, 'out') });
    reporter.onTestEnd(testCase('one'), result([]));
    reporter.onEnd({ status: 'passed' } as never);
    expect(existsSync(join(directory, 'out'))).toBe(false);
    expect(log).toHaveBeenCalledWith('Privacy guard: nothing found in 1 tests.');
  });

  it('adds the table to the summary of a GitHub run', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const summary = join(directory, 'step-summary.md');
    vi.stubEnv('GITHUB_STEP_SUMMARY', summary);
    const reporter = new PrivacyReporter({ outputDir: join(directory, 'out') });
    reporter.onTestEnd(testCase('one'), result([request('x.test', '/')]));
    reporter.onEnd({ status: 'passed' } as never);
    expect(readFileSync(summary, 'utf8')).toContain('## Privacy guard');
  });
});
