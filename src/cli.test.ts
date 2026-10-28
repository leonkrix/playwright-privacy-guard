import { describe, expect, it } from 'vitest';

import {
  exitCodeOf,
  mergeOptions,
  normalizeUrl,
  type PageResult,
  parseCli,
  parseUrlList,
  renderReport,
  renderText,
} from './cli.js';
import type { PrivacyReport } from './install.js';
import type { Finding } from './types.js';

const finding = (subject: string, extra: Partial<Finding> = {}): Finding => ({
  rule: 'requests',
  level: 'error',
  subject,
  summary: `1 request to ${subject}`,
  details: [`first: https://${subject}/a.js`],
  count: 1,
  page: '/',
  allow: { key: 'requests', value: subject },
  at: 10,
  ...extra,
});

const report = (findings: Finding[]): PrivacyReport => ({
  version: 1,
  generatedAt: 'now',
  mode: 'report',
  findings,
  known: [],
  allowed: [],
  counts: {
    errors: findings.filter((item) => item.level === 'error').length,
    warnings: findings.filter((item) => item.level === 'warn').length,
  },
  pages: ['/'],
  observations: 1,
  dropped: 0,
});

const clean: PageResult = { url: 'https://a.example/', http: 200, report: report([]) };
const leaky: PageResult = {
  url: 'https://b.example/',
  finalUrl: 'https://b.example/home',
  http: 200,
  report: report([
    finding('www.google-analytics.com', {
      tracker: { entity: 'Google Analytics', category: 'analytics' },
    }),
    finding('fonts.gstatic.com', { level: 'warn' }),
  ]),
};
const broken: PageResult = {
  url: 'https://c.example/',
  error: 'page.goto: Timeout 45000ms exceeded.',
};

describe('parseCli', () => {
  it('reads addresses and options', () => {
    const parsed = parseCli([
      'scan',
      'example.com',
      'http://localhost:3000/a',
      '--browser',
      'firefox',
      '--format=json',
      '--fail-on',
      'warn',
      '--wait',
      '1.5',
      '--timeout',
      '10',
      '--no-scroll',
      '--all-rules',
      '--out',
      'report/privacy.json',
      '--options',
      'guard.json',
      '--device',
      'iPhone 13',
      '--file',
      'urls.txt',
    ]);
    expect(parsed).toEqual({
      kind: 'scan',
      scan: {
        urls: ['https://example.com/', 'http://localhost:3000/a'],
        file: 'urls.txt',
        browser: 'firefox',
        format: 'json',
        out: 'report/privacy.json',
        failOn: 'warn',
        wait: 1.5,
        scroll: false,
        timeout: 10_000,
        allRules: true,
        optionsFile: 'guard.json',
        device: 'iPhone 13',
      },
    });
  });

  it('has defaults', () => {
    const parsed = parseCli(['scan', 'https://example.com']);
    expect(parsed).toMatchObject({
      kind: 'scan',
      scan: { browser: 'chromium', format: 'text', failOn: 'error', wait: 4, scroll: true },
    });
  });

  it('answers help, version and no command', () => {
    expect(parseCli(['--help'])).toEqual({ kind: 'help' });
    expect(parseCli(['-h'])).toEqual({ kind: 'help' });
    expect(parseCli([])).toEqual({ kind: 'help' });
    expect(parseCli(['--version'])).toEqual({ kind: 'version' });
  });

  it('says what is wrong', () => {
    const message = (args: string[]): string => {
      const parsed = parseCli(args);
      return parsed.kind === 'error' ? parsed.message : parsed.kind;
    };
    expect(message(['crawl', 'example.com'])).toContain('unknown command "crawl"');
    expect(message(['scan', 'example.com', '--browser', 'edge'])).toContain(
      '--browser is one of chromium, firefox, webkit',
    );
    expect(message(['scan', 'example.com', '--format', 'xml'])).toContain('--format');
    expect(message(['scan', 'example.com', '--fail-on', 'never-ever'])).toContain('--fail-on');
    expect(message(['scan', 'example.com', '--wait', 'soon'])).toContain('--wait needs a number');
    expect(message(['scan', 'example.com', '--timeout', '-1'])).toContain('--timeout');
    expect(message(['scan', 'ftp://example.com'])).toContain('not an http or https address');
    expect(message(['scan', 'example.com', '--nope'])).toContain('--nope');
  });
});

describe('addresses', () => {
  it('adds https when there is no scheme', () => {
    expect(normalizeUrl('example.com/a')).toBe('https://example.com/a');
    expect(normalizeUrl(' http://localhost:3000 ')).toBe('http://localhost:3000/');
    expect(normalizeUrl('file:///etc/passwd')).toBeUndefined();
    expect(normalizeUrl('javascript:alert(1)')).toBeUndefined();
  });

  it('reads a list: one per line, comments and empty lines left out', () => {
    expect(
      parseUrlList('# my pages\nexample.com\n\nexample.org/a # the second\r\n  \n#last\n'),
    ).toEqual(['example.com', 'example.org/a']);
  });
});

describe('exit code', () => {
  it('is 0 for a clean run and 1 for an error', () => {
    expect(exitCodeOf([clean], 'error')).toBe(0);
    expect(exitCodeOf([clean, leaky], 'error')).toBe(1);
  });

  it('lets warnings through unless asked', () => {
    const warning: PageResult = {
      url: 'https://d.example/',
      report: report([finding('x.test', { level: 'warn' })]),
    };
    expect(exitCodeOf([warning], 'error')).toBe(0);
    expect(exitCodeOf([warning], 'warn')).toBe(1);
    expect(exitCodeOf([leaky], 'never')).toBe(0);
  });

  it('is 2 when a page could not be loaded, whatever else', () => {
    expect(exitCodeOf([broken], 'never')).toBe(2);
    expect(exitCodeOf([leaky, broken], 'error')).toBe(2);
  });
});

describe('options', () => {
  it('lets the file win over the preset and keeps both sets of rules', () => {
    const merged = mergeOptions(
      { headers: 'recommended', rules: { fingerprint: 'warn', cspQuality: 'warn' } },
      { headers: 'strict', rules: { fingerprint: 'off' }, allow: { requests: ['a.example'] } },
    );
    expect(merged).toEqual({
      headers: 'strict',
      rules: { fingerprint: 'off', cspQuality: 'warn' },
      allow: { requests: ['a.example'] },
    });
  });
});

describe('the reports', () => {
  it('writes text with a block per page, the company, and what to put in the options file', () => {
    const text = renderText([clean, leaky, broken]);
    expect(text).toContain('https://a.example/ (HTTP 200)\n  nothing found');
    expect(text).toContain('https://b.example/ (now https://b.example/home) (HTTP 200)');
    expect(text).toContain('1 error, 1 warning');
    expect(text).toContain('www.google-analytics.com  [Google Analytics, analytics]');
    expect(text).toContain('could not be loaded: page.goto: Timeout');
    expect(text).toContain('3 pages: 1 error, 1 warning, 1 could not be loaded');
    expect(text).toContain('"allow": {');
    expect(text).toContain('"fonts.gstatic.com"');
  });

  it('says nothing about options when there is nothing to allow', () => {
    expect(renderText([clean])).not.toContain('--options');
  });

  it('writes JSON that can be read back', () => {
    const json = JSON.parse(renderReport([clean, leaky, broken], 'json', 'webkit', 'then')) as {
      version: number;
      browser: string;
      generatedAt: string;
      pages: PageResult[];
    };
    expect(json).toMatchObject({ version: 1, browser: 'webkit', generatedAt: 'then' });
    expect(json.pages).toHaveLength(3);
    expect(json.pages[1]?.report?.findings).toHaveLength(2);
    expect(json.pages[2]?.error).toContain('Timeout');
  });

  it('writes Markdown and HTML over all pages, and names the pages that failed', () => {
    const markdown = renderReport([clean, leaky, broken], 'markdown', 'chromium');
    expect(markdown).toContain('## Privacy guard');
    expect(markdown).toContain('www.google-analytics.com');
    expect(markdown).toContain('1 pages could not be loaded: https://c.example/');
    const html = renderReport([clean, leaky], 'html', 'chromium');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('www.google-analytics.com');
  });
});
