import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

import { aggregate, renderMarkdown, renderSiteHtml, type TestEntry } from './aggregate.js';

export interface PrivacyReporterOptions {
  /** Where the report goes (default `privacy-report`) */
  outputDir?: string;
  /** Add the table to the summary of a GitHub Actions run (default true, only there) */
  githubSummary?: boolean;
  /** Print one line at the end of the run (default true) */
  console?: boolean;
  /**
   * Tests that are left out of the report: a text or a regular expression that is searched in the
   * title of the test (project, file and names). For tests that make a page misbehave on purpose.
   * A test that is expected to fail (`test.fail()`) is always left out.
   */
  ignore?: (string | RegExp)[];
}

/**
 * A Playwright reporter that reads the reports of the guard from all tests and writes one page for
 * the whole run: `privacy-report/index.html`, `summary.md` and `summary.json`. Use it next to the
 * reporter you have: `reporter: [['list'], ['playwright-privacy-guard/reporter']]`.
 */
export default class PrivacyReporter implements Reporter {
  private readonly entries: TestEntry[] = [];
  private tests = 0;
  private readonly options: Required<PrivacyReporterOptions>;

  constructor(options: PrivacyReporterOptions = {}) {
    this.options = {
      outputDir: options.outputDir ?? 'privacy-report',
      githubSummary: options.githubSummary ?? true,
      console: options.console ?? true,
      ignore: options.ignore ?? [],
    };
  }

  printsToStdio(): boolean {
    return false;
  }

  private ignored(test: TestCase): boolean {
    const title = test.titlePath().join(' › ');
    return this.options.ignore.some((entry) =>
      typeof entry === 'string' ? title.includes(entry) : entry.test(title),
    );
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.tests += 1;
    if (test.expectedStatus === 'failed' || this.ignored(test)) {
      return;
    }
    const attachment = result.attachments.find((item) => item.name === 'privacy-report.json');
    if (attachment === undefined) {
      return;
    }
    try {
      const text =
        attachment.body !== undefined
          ? attachment.body.toString('utf8')
          : attachment.path === undefined
            ? undefined
            : readFileSync(attachment.path, 'utf8');
      if (text === undefined) {
        return;
      }
      const report = JSON.parse(text) as TestEntry['report'];
      const project = test.parent.project()?.name;
      this.entries.push({
        test: [project, ...test.titlePath().slice(2)]
          .filter((part) => part !== undefined && part !== '')
          .join(' › '),
        report,
      });
    } catch {
      // An attachment that cannot be read is left out; the test has its own report
    }
  }

  onEnd(_result: FullResult): void {
    if (this.entries.length === 0) {
      if (this.options.console) {
        console.log(`Privacy guard: nothing found in ${String(this.tests)} tests.`);
      }
      return;
    }
    const result = aggregate(this.entries, this.tests);
    const allowedNote =
      result.allowed.length > 0 ? ` ${String(result.allowed.length)} allowed on purpose.` : '';
    const directory = resolve(this.options.outputDir);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'index.html'), renderSiteHtml(result));
    const markdown = renderMarkdown(result);
    writeFileSync(join(directory, 'summary.md'), markdown);
    writeFileSync(
      join(directory, 'summary.json'),
      `${JSON.stringify({ ...result, rows: result.rows.map(({ example: _example, ...row }) => row) }, null, 2)}\n`,
    );
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (this.options.githubSummary && summaryFile !== undefined && summaryFile !== '') {
      try {
        appendFileSync(summaryFile, `${markdown}\n`);
      } catch {
        // The summary is a convenience
      }
    }
    if (this.options.console) {
      console.log(
        `Privacy guard: ${String(result.errors)} errors and ${String(result.warnings)} warnings in ${String(result.testsWithFindings)} of ${String(result.tests)} tests.${allowedNote} Report: ${join(this.options.outputDir, 'index.html')}`,
      );
    }
  }
}
