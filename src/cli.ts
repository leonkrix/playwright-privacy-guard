import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

import {
  type Browser,
  type BrowserType,
  chromium,
  devices,
  firefox,
  type Page,
  webkit,
} from '@playwright/test';

import { aggregate, renderMarkdown, renderSiteHtml, type TestEntry } from './aggregate.js';
import { describeFinding, formatAllowed, titleOf } from './format.js';
import { installPrivacyGuard, type PrivacyReport } from './install.js';
import type { PrivacyGuardOptions } from './types.js';

export type Format = 'text' | 'json' | 'markdown' | 'html';
export type FailOn = 'error' | 'warn' | 'never';
export type BrowserName = 'chromium' | 'firefox' | 'webkit';

/** What the command line asked for. */
export interface ScanArguments {
  urls: string[];
  /** A file with more addresses */
  file: string | undefined;
  browser: BrowserName;
  format: Format;
  out: string | undefined;
  failOn: FailOn;
  /** Seconds to leave the page alone after it has loaded */
  wait: number;
  scroll: boolean;
  /** Milliseconds to wait for a page to load */
  timeout: number;
  allRules: boolean;
  optionsFile: string | undefined;
  device: string | undefined;
}

export type Parsed =
  | { kind: 'scan'; scan: ScanArguments }
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string };

const FORMATS: readonly Format[] = ['text', 'json', 'markdown', 'html'];
const FAIL_ON: readonly FailOn[] = ['error', 'warn', 'never'];
const BROWSERS: readonly BrowserName[] = ['chromium', 'firefox', 'webkit'];

export const HELP = `Look at public pages the way the privacy guard looks at a test.

Usage
  playwright-privacy-guard scan <url...> [options]

Every page is opened in a fresh browser, left alone for a few seconds and scrolled once, without
clicks and without accepting anything. The guard reports requests to other origins, cookies, data
stored on the device, policy violations, errors and the rest of its rules, with who is behind them.

Options
  --file <path>         Read more addresses from a file, one per line (# starts a comment)
  --browser <name>      chromium (default), firefox or webkit
  --format <name>       text (default), json, markdown or html
  --out <path>          Write the report to a file instead of the console
  --fail-on <level>     error (default), warn or never: when the exit code is 1
  --options <path>      A JSON file with the options of the guard, for example
                        { "allow": { "requests": ["api.example.com"] } }
  --all-rules           Also look at headers, the policy, fingerprinting and cookie attributes
  --wait <seconds>      How long to leave a page alone after the load (default 4)
  --no-scroll           Do not scroll through the page
  --timeout <seconds>   How long a page may take to load (default 45)
  --device <name>       A device of Playwright, for example "iPhone 13"
  -h, --help            This text
  -v, --version         The version

Exit code: 0 when nothing at the level of --fail-on was found, 1 when something was, 2 when the
command was wrong or a page could not be loaded.

Playwright needs its browser: npx playwright install chromium
`;

type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

function numberOf(text: string | undefined, fallback: number, name: string): Checked<number> {
  if (text === undefined) {
    return { ok: true, value: fallback };
  }
  const value = Number(text);
  return Number.isFinite(value) && value >= 0
    ? { ok: true, value }
    : { ok: false, message: `--${name} needs a number, not "${text}"` };
}

function choiceOf<T extends string>(
  text: string | undefined,
  allowed: readonly T[],
  fallback: T,
  name: string,
): Checked<T> {
  if (text === undefined) {
    return { ok: true, value: fallback };
  }
  const found = allowed.find((item) => item === text);
  return found === undefined
    ? { ok: false, message: `--${name} is one of ${allowed.join(', ')}, not "${text}"` }
    : { ok: true, value: found };
}

/** An address as a person types it: `example.com` means `https://example.com`. */
export function normalizeUrl(text: string): string | undefined {
  const trimmed = text.trim();
  const full = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(full);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** The addresses of a file: one per line, empty lines and `#` comments left out. */
export function parseUrlList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/** Reads the command line. Pure, so that it can be tested without a browser. */
export function parseCli(argv: readonly string[]): Parsed {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        file: { type: 'string' },
        browser: { type: 'string' },
        format: { type: 'string' },
        out: { type: 'string' },
        'fail-on': { type: 'string' },
        options: { type: 'string' },
        'all-rules': { type: 'boolean' },
        wait: { type: 'string' },
        'no-scroll': { type: 'boolean' },
        timeout: { type: 'string' },
        device: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  const { values, positionals } = parsed;
  if (values.help === true) {
    return { kind: 'help' };
  }
  if (values.version === true) {
    return { kind: 'version' };
  }
  const [command, ...rest] = positionals;
  if (command === undefined) {
    return { kind: 'help' };
  }
  if (command !== 'scan') {
    return { kind: 'error', message: `unknown command "${command}" (the only one is "scan")` };
  }
  const text = (name: string): string | undefined => {
    const value = values[name];
    return typeof value === 'string' ? value : undefined;
  };
  const browser = choiceOf(text('browser'), BROWSERS, 'chromium', 'browser');
  const format = choiceOf(text('format'), FORMATS, 'text', 'format');
  const failOn = choiceOf(text('fail-on'), FAIL_ON, 'error', 'fail-on');
  const wait = numberOf(text('wait'), 4, 'wait');
  const timeout = numberOf(text('timeout'), 45, 'timeout');
  for (const checked of [browser, format, failOn, wait, timeout]) {
    if (!checked.ok) {
      return { kind: 'error', message: checked.message };
    }
  }
  if (!browser.ok || !format.ok || !failOn.ok || !wait.ok || !timeout.ok) {
    return { kind: 'error', message: 'wrong option' };
  }
  const urls: string[] = [];
  for (const item of rest) {
    const url = normalizeUrl(item);
    if (url === undefined) {
      return { kind: 'error', message: `"${item}" is not an http or https address` };
    }
    urls.push(url);
  }
  return {
    kind: 'scan',
    scan: {
      urls,
      file: text('file'),
      browser: browser.value,
      format: format.value,
      out: text('out'),
      failOn: failOn.value,
      wait: wait.value,
      scroll: values['no-scroll'] !== true,
      timeout: timeout.value * 1000,
      allRules: values['all-rules'] === true,
      optionsFile: text('options'),
      device: text('device'),
    },
  };
}

/** What happened to one address. */
export interface PageResult {
  url: string;
  finalUrl?: string;
  http?: number;
  /** Set when the page could not be loaded: then there is no report */
  error?: string;
  report?: PrivacyReport;
}

/** The options of `--all-rules`: everything the guard can look at. */
export const ALL_RULES: PrivacyGuardOptions = {
  headers: 'recommended',
  cookieAttributes: {},
  rules: { fingerprint: 'warn', cspQuality: 'warn' },
};

/** The options of the file merged over the preset, where the file wins. */
export function mergeOptions(
  base: PrivacyGuardOptions,
  given: PrivacyGuardOptions,
): PrivacyGuardOptions {
  return { ...base, ...given, rules: { ...base.rules, ...given.rules } };
}

async function scroll(page: Page): Promise<void> {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let at = 0; at < Math.min(height, 12_000); at += 500) {
    await page.evaluate((top) => {
      window.scrollTo(0, top);
    }, at);
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);
}

/** Opens one address in a fresh browser context and returns what the guard found. */
export async function scanPage(
  browser: Browser,
  url: string,
  settings: ScanArguments,
  options: PrivacyGuardOptions,
): Promise<PageResult> {
  const device = settings.device === undefined ? undefined : devices[settings.device];
  if (settings.device !== undefined && device === undefined) {
    return { url, error: `unknown device "${settings.device}"` };
  }
  const context = await browser.newContext(device ?? { viewport: { width: 1280, height: 800 } });
  try {
    const guard = await installPrivacyGuard(context, options, url);
    const page = await context.newPage();
    const result: PageResult = { url };
    try {
      const response = await page.goto(url, { waitUntil: 'load', timeout: settings.timeout });
      if (response !== null) {
        result.http = response.status();
      }
      await page.waitForTimeout(settings.wait * 1000);
      if (settings.scroll) {
        await scroll(page);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { url, error: message.split('\n')[0] ?? message };
    }
    result.finalUrl = page.url();
    result.report = await guard.report();
    return result;
  } finally {
    await context.close();
  }
}

/** The text report: one block per page, what was found, and how to allow what is meant. */
export function renderText(results: readonly PageResult[]): string {
  const lines: string[] = [];
  const hints = new Map<string, string[]>();
  let errors = 0;
  let warnings = 0;
  let failed = 0;
  for (const result of results) {
    const where =
      result.finalUrl !== undefined && result.finalUrl !== result.url
        ? `${result.url} (now ${result.finalUrl})`
        : result.url;
    if (result.report === undefined) {
      failed += 1;
      lines.push(where, `  could not be loaded: ${result.error ?? 'unknown error'}`, '');
      continue;
    }
    const { findings, counts, allowed } = result.report;
    errors += counts.errors;
    warnings += counts.warnings;
    const status = result.http === undefined ? '' : ` (HTTP ${String(result.http)})`;
    if (findings.length === 0) {
      lines.push(`${where}${status}`, '  nothing found');
    } else {
      lines.push(
        `${where}${status}`,
        `  ${String(counts.errors)} ${counts.errors === 1 ? 'error' : 'errors'}, ${String(counts.warnings)} ${counts.warnings === 1 ? 'warning' : 'warnings'}`,
      );
      for (const rule of new Set(findings.map((found) => found.rule))) {
        const own = findings.filter((found) => found.rule === rule);
        lines.push('', `  ${titleOf(rule)} (${String(own.length)})`);
        for (const found of own) {
          lines.push(...describeFinding(found).map((line) => `  ${line}`));
        }
      }
    }
    for (const found of findings) {
      if (found.allow !== undefined) {
        const list = hints.get(found.allow.key) ?? [];
        if (!list.includes(found.allow.value)) {
          list.push(found.allow.value);
        }
        hints.set(found.allow.key, list);
      }
    }
    const extra = formatAllowed(allowed);
    if (extra !== '') {
      lines.push(
        ...extra
          .split('\n')
          .slice(1)
          .map((line) => (line === '' ? '' : `  ${line}`)),
      );
    }
    lines.push('');
  }
  lines.push(
    `${String(results.length)} ${results.length === 1 ? 'page' : 'pages'}: ${String(errors)} ${errors === 1 ? 'error' : 'errors'}, ${String(warnings)} ${warnings === 1 ? 'warning' : 'warnings'}${failed > 0 ? `, ${String(failed)} could not be loaded` : ''}`,
  );
  if (hints.size > 0) {
    const allow: Record<string, string[] | true> = {};
    for (const [key, values] of hints) {
      allow[key] = key === 'serviceWorkers' ? true : values;
    }
    lines.push(
      '',
      'If this is meant, put it in a file for --options (the reason helps the next reader:',
      '{ "match": "...", "reason": "..." } instead of a text):',
      '',
      JSON.stringify({ allow }, null, 2),
    );
  }
  return `${lines.join('\n')}\n`;
}

function entriesOf(results: readonly PageResult[]): TestEntry[] {
  return results.flatMap((result) =>
    result.report === undefined
      ? []
      : [
          {
            test: result.url,
            report: {
              findings: result.report.findings,
              known: result.report.known,
              allowed: result.report.allowed,
            },
          },
        ],
  );
}

/** A report in the format that was asked for. */
export function renderReport(
  results: readonly PageResult[],
  format: Format,
  browser: BrowserName,
  generatedAt = new Date().toISOString(),
): string {
  if (format === 'json') {
    return `${JSON.stringify({ version: 1, generatedAt, browser, pages: results }, null, 2)}\n`;
  }
  const failed = results.filter((result) => result.report === undefined);
  const total = aggregate(entriesOf(results), results.length - failed.length, 'addresses');
  if (format === 'markdown') {
    const note =
      failed.length === 0
        ? ''
        : `\n${String(failed.length)} pages could not be loaded: ${failed.map((item) => item.url).join(', ')}\n`;
    return `${renderMarkdown(total)}${note}`;
  }
  if (format === 'html') {
    return renderSiteHtml(total);
  }
  return renderText(results);
}

/** The exit code: 2 when a page could not be loaded, 1 when something was found, else 0. */
export function exitCodeOf(results: readonly PageResult[], failOn: FailOn): number {
  if (results.some((result) => result.report === undefined)) {
    return 2;
  }
  if (failOn === 'never') {
    return 0;
  }
  const found = results.some((result) =>
    result.report?.findings.some((item) => failOn === 'warn' || item.level === 'error'),
  );
  return found ? 1 : 0;
}

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

const defaultIo: Io = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};

const ENGINES: Record<BrowserName, BrowserType> = { chromium, firefox, webkit };

async function version(): Promise<string> {
  const text = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  const { version: value } = JSON.parse(text) as { version?: string };
  return value ?? 'unknown';
}

async function readOptions(path: string | undefined): Promise<PrivacyGuardOptions> {
  if (path === undefined) {
    return {};
  }
  const text = await readFile(path, 'utf8');
  return JSON.parse(text) as PrivacyGuardOptions;
}

/** The whole command. Returns the exit code. */
export async function main(argv: readonly string[], io: Io = defaultIo): Promise<number> {
  const parsed = parseCli(argv);
  if (parsed.kind === 'help') {
    io.out(HELP);
    return 0;
  }
  if (parsed.kind === 'version') {
    io.out(`${await version()}\n`);
    return 0;
  }
  if (parsed.kind === 'error') {
    io.err(`playwright-privacy-guard: ${parsed.message}\nTry --help.\n`);
    return 2;
  }
  const { scan } = parsed;
  let options: PrivacyGuardOptions;
  const urls = [...scan.urls];
  try {
    options = mergeOptions(scan.allRules ? ALL_RULES : {}, await readOptions(scan.optionsFile));
    const path = scan.file;
    if (path !== undefined) {
      for (const line of parseUrlList(await readFile(path, 'utf8'))) {
        const url = normalizeUrl(line);
        if (url === undefined) {
          io.err(
            `playwright-privacy-guard: "${line}" in ${path} is not an http or https address\n`,
          );
          return 2;
        }
        urls.push(url);
      }
    }
  } catch (error) {
    io.err(`playwright-privacy-guard: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  if (urls.length === 0) {
    io.err('playwright-privacy-guard: give at least one address, or --file\nTry --help.\n');
    return 2;
  }
  let browser: Browser;
  try {
    browser = await ENGINES[scan.browser].launch();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.err(
      `playwright-privacy-guard: could not start ${scan.browser}: ${message.split('\n')[0] ?? ''}\n` +
        `Install it once with: npx playwright install ${scan.browser}\n`,
    );
    return 2;
  }
  const results: PageResult[] = [];
  try {
    for (const [index, url] of urls.entries()) {
      io.err(`[${String(index + 1)}/${String(urls.length)}] ${url}\n`);
      try {
        results.push(await scanPage(browser, url, scan, options));
      } catch (error) {
        // An option the guard refuses (a wrong name in the file) is a mistake of the caller
        io.err(
          `playwright-privacy-guard: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        return 2;
      }
    }
  } finally {
    await browser.close();
  }
  const report = renderReport(results, scan.format, scan.browser);
  if (scan.out === undefined) {
    io.out(report);
  } else {
    await mkdir(dirname(scan.out), { recursive: true });
    await writeFile(scan.out, report);
    io.err(`written to ${scan.out}\n`);
  }
  return exitCodeOf(results, scan.failOn);
}
