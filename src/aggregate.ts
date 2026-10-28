import { describeTracker, titleOf } from './format.js';
import { escapeHtml, page, renderFinding } from './report-html.js';
import { type AllowedUse, type Finding, RULE_IDS, type RuleId } from './types.js';

/** The report of one test, as the reporter reads it from the attachment. */
export interface TestEntry {
  /** `chromium › home.spec.ts › the home page` */
  test: string;
  report: {
    findings: Finding[];
    known?: Finding[];
    allowed?: AllowedUse[];
  };
}

/** One thing that was allowed on purpose, over all tests. */
export interface AllowedRow {
  rule: RuleId;
  what: string;
  entry: string;
  reason: string | undefined;
  count: number;
  tests: string[];
}

/** One kind of problem over all tests: what it is, where, and how often. */
export interface Row {
  rule: RuleId;
  level: 'error' | 'warn';
  subject: string;
  summary: string;
  tracker: string | undefined;
  pages: string[];
  tests: string[];
  count: number;
  example: Finding;
}

export interface Aggregate {
  /** All tests the reporter saw */
  tests: number;
  /** Tests that have at least one finding */
  testsWithFindings: number;
  errors: number;
  warnings: number;
  known: number;
  rows: Row[];
  /** What the allow entries let pass on purpose, with their reasons */
  allowed: AllowedRow[];
}

/** Puts the findings of all tests together: the same problem on many pages is one row. */
export function aggregate(entries: readonly TestEntry[], totalTests: number): Aggregate {
  const rows = new Map<string, Row>();
  const allowed = new Map<string, AllowedRow>();
  let known = 0;
  for (const entry of entries) {
    known += entry.report.known?.length ?? 0;
    for (const use of entry.report.allowed ?? []) {
      const key = [use.rule, use.what, use.entry, use.reason ?? ''].join('|');
      const row = allowed.get(key) ?? {
        rule: use.rule,
        what: use.what,
        entry: use.entry,
        reason: use.reason,
        count: 0,
        tests: [],
      };
      row.count += use.count;
      if (!row.tests.includes(entry.test)) {
        row.tests.push(entry.test);
      }
      allowed.set(key, row);
    }
    for (const found of entry.report.findings) {
      const key = `${found.rule}\n${found.level}\n${found.subject}`;
      const row = rows.get(key) ?? {
        rule: found.rule,
        level: found.level,
        subject: found.subject,
        summary: found.summary,
        tracker: describeTracker(found),
        pages: [],
        tests: [],
        count: 0,
        example: found,
      };
      if (!row.pages.includes(found.page)) {
        row.pages.push(found.page);
      }
      if (!row.tests.includes(entry.test)) {
        row.tests.push(entry.test);
      }
      row.count += found.count;
      rows.set(key, row);
    }
  }
  const list = [...rows.values()].sort(
    (a, b) =>
      (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1) ||
      RULE_IDS.indexOf(a.rule) - RULE_IDS.indexOf(b.rule) ||
      b.tests.length - a.tests.length ||
      a.subject.localeCompare(b.subject),
  );
  return {
    tests: totalTests,
    testsWithFindings: entries.filter((entry) => entry.report.findings.length > 0).length,
    errors: list.filter((row) => row.level === 'error').length,
    warnings: list.filter((row) => row.level === 'warn').length,
    known,
    rows: list,
    allowed: [...allowed.values()].sort(
      (a, b) =>
        RULE_IDS.indexOf(a.rule) - RULE_IDS.indexOf(b.rule) ||
        b.tests.length - a.tests.length ||
        a.what.localeCompare(b.what),
    ),
  };
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function shorten(list: readonly string[], limit = 3): string {
  const shown = list.slice(0, limit).join(', ');
  return list.length > limit ? `${shown} and ${String(list.length - limit)} more` : shown;
}

function allowedMarkdown(result: Aggregate): string[] {
  if (result.allowed.length === 0) {
    return [];
  }
  return [
    '',
    `### Allowed on purpose (${String(result.allowed.length)})`,
    '',
    '| Rule | What | Allowed by | Reason | Tests |',
    '| --- | --- | --- | --- | --- |',
    ...result.allowed
      .slice(0, 60)
      .map(
        (row) =>
          `| ${titleOf(row.rule)} | ${cell(row.what)} | \`${cell(row.entry)}\` | ${cell(row.reason ?? 'none given')} | ${String(row.tests.length)} |`,
      ),
  ];
}

function allowedHtml(result: Aggregate): string {
  if (result.allowed.length === 0) {
    return '';
  }
  const rows = result.allowed.map(
    (row) =>
      `<tr><td>${escapeHtml(titleOf(row.rule))}</td><td>${escapeHtml(row.what)}</td><td><code>${escapeHtml(row.entry)}</code></td><td>${row.reason === undefined ? '<span class="muted">none given</span>' : escapeHtml(row.reason)}</td><td>${String(row.tests.length)}</td></tr>`,
  );
  return `<h2>Allowed on purpose (${String(result.allowed.length)})</h2>
<p class="muted">What the allow entries let pass, and why. Nothing here fails a test.</p>
<table>
<thead><tr><th>Rule</th><th>What</th><th>Allowed by</th><th>Reason</th><th>Tests</th></tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table>`;
}

/** A table for the summary of a GitHub Actions run, or any Markdown viewer. */
export function renderMarkdown(result: Aggregate): string {
  if (result.rows.length === 0) {
    const none = ['## Privacy guard', '', `No findings in ${String(result.tests)} tests.`];
    return `${[...none, ...allowedMarkdown(result)].join('\n')}\n`;
  }
  const lines = [
    '## Privacy guard',
    '',
    `${String(result.errors)} errors and ${String(result.warnings)} warnings, in ${String(result.testsWithFindings)} of ${String(result.tests)} tests.${result.known > 0 ? ` ${String(result.known)} known findings from the baseline are left out.` : ''}`,
    '',
    '| Level | Rule | What | Who | Pages | Tests |',
    '| --- | --- | --- | --- | --- | --- |',
    ...result.rows
      .slice(0, 60)
      .map(
        (row) =>
          `| ${row.level} | ${titleOf(row.rule)} | ${cell(row.subject)} | ${cell(row.tracker ?? '')} | ${cell(shorten(row.pages))} | ${String(row.tests.length)} |`,
      ),
  ];
  if (result.rows.length > 60) {
    lines.push('', `${String(result.rows.length - 60)} more rows are in the HTML report.`);
  }
  lines.push(...allowedMarkdown(result));
  return `${lines.join('\n')}\n`;
}

/** The page of the whole run: one row per problem, with the pages and tests it was seen on. */
export function renderSiteHtml(result: Aggregate): string {
  const body = `<h1>Privacy guard</h1>
<p class="muted">One row per problem over the whole run.</p>
<div class="counts">
  <div class="count ${result.errors > 0 ? 'error' : 'ok'}"><b>${String(result.errors)}</b>errors</div>
  <div class="count warn"><b>${String(result.warnings)}</b>warnings</div>
  <div class="count"><b>${String(result.testsWithFindings)} / ${String(result.tests)}</b>tests with findings</div>
  ${result.known > 0 ? `<div class="count"><b>${String(result.known)}</b>known (baseline)</div>` : ''}
</div>
${
  result.rows.length === 0
    ? '<p>Nothing found. The pages talk to their own origin, set no cookies and store nothing.</p>'
    : `<table>
<thead><tr><th>Level</th><th>Rule</th><th>What</th><th>Who</th><th>Pages</th><th>Tests</th></tr></thead>
<tbody>
${result.rows
  .map(
    (row) =>
      `<tr><td>${row.level}</td><td>${escapeHtml(titleOf(row.rule))}</td><td>${escapeHtml(row.subject)}</td><td>${escapeHtml(row.tracker ?? '')}</td><td>${escapeHtml(shorten(row.pages, 5))}</td><td>${String(row.tests.length)}</td></tr>`,
  )
  .join('\n')}
</tbody>
</table>
<h2>Details</h2>
${result.rows.map((row) => renderFinding(row.example)).join('\n')}`
}
${allowedHtml(result)}`;
  return page('Privacy guard', body);
}
