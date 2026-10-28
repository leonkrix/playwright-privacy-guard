import { describeTracker, titleOf } from './format.js';
import type { AllowedUse, Finding, RuleId } from './types.js';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The styles of every page this package writes (one place, no script, light and dark). */
export const REPORT_CSS = `
:root { color-scheme: light dark; --bg: #fff; --fg: #1b1f24; --muted: #59636e; --line: #d1d9e0; --card: #f6f8fa; --error: #cf222e; --warn: #9a6700; --ok: #1a7f37; --chip: #ddf4ff; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --fg: #e6edf3; --muted: #8b949e; --line: #30363d; --card: #161b22; --error: #ff7b72; --warn: #d29922; --ok: #3fb950; --chip: #0c2d6b; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 48px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
main { max-width: 56rem; margin: 0 auto; }
h1 { font-size: 1.5rem; margin: 0 0 4px; }
h2 { font-size: 1.1rem; margin: 32px 0 8px; }
p, ul { margin: 8px 0; }
.muted { color: var(--muted); }
.counts { display: flex; gap: 8px; flex-wrap: wrap; margin: 16px 0; }
.count { border: 1px solid var(--line); border-radius: 8px; padding: 8px 14px; background: var(--card); }
.count b { display: block; font-size: 1.4rem; line-height: 1.2; }
.count.error b { color: var(--error); } .count.warn b { color: var(--warn); } .count.ok b { color: var(--ok); }
.finding { border: 1px solid var(--line); border-left-width: 4px; border-radius: 6px; background: var(--card); padding: 10px 14px; margin: 8px 0; }
.finding.error { border-left-color: var(--error); } .finding.warn { border-left-color: var(--warn); }
.finding h3 { font-size: 1rem; margin: 0; word-break: break-word; }
.finding .level { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; margin-right: 6px; }
.finding.error .level { color: var(--error); } .finding.warn .level { color: var(--warn); }
.chip { display: inline-block; background: var(--chip); border-radius: 999px; padding: 0 8px; font-size: 0.8rem; margin-left: 6px; font-weight: normal; }
.finding ul { padding-left: 1.2rem; color: var(--muted); font-size: 0.9rem; }
.finding li { word-break: break-word; }
code, pre { font: 13px/1.5 ui-monospace, 'Cascadia Code', Consolas, monospace; }
pre { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 12px; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: top; word-break: break-word; }
th { color: var(--muted); font-weight: 600; }
a { color: inherit; }
`;

export function renderFinding(found: Finding): string {
  const tracker = describeTracker(found);
  const details = found.details.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  const times = found.count > 1 ? ` <span class="muted">(${String(found.count)}x)</span>` : '';
  return `<article class="finding ${found.level}">
  <h3><span class="level">${found.level}</span>${escapeHtml(found.subject)}${
    tracker === undefined ? '' : `<span class="chip">${escapeHtml(tracker)}</span>`
  }${times}</h3>
  <div>${escapeHtml(found.summary)} <span class="muted">on ${escapeHtml(found.page || '/')}</span></div>
  ${details === '' ? '' : `<ul>${details}</ul>`}
</article>`;
}

/** The findings grouped by rule, as HTML. */
export function renderGroups(findings: readonly Finding[]): string {
  const rules = [...new Set(findings.map((found) => found.rule))];
  return rules
    .map((rule: RuleId) => {
      const own = findings.filter((found) => found.rule === rule);
      return `<h2>${escapeHtml(titleOf(rule))} (${String(own.length)})</h2>\n${own.map(renderFinding).join('\n')}`;
    })
    .join('\n');
}

/** The list of what was allowed on purpose, with the reasons. */
export function renderAllowed(allowed: readonly AllowedUse[]): string {
  if (allowed.length === 0) {
    return '';
  }
  return `<h2>Allowed on purpose (${String(allowed.length)})</h2>
<table>
<thead><tr><th>Rule</th><th>What</th><th>Allowed by</th><th>Reason</th><th>Times</th></tr></thead>
<tbody>
${allowed
  .map(
    (use) =>
      `<tr><td>${escapeHtml(titleOf(use.rule))}</td><td>${escapeHtml(use.what)}</td><td><code>${escapeHtml(use.entry)}</code></td><td>${use.reason === undefined ? '<span class="muted">none given</span>' : escapeHtml(use.reason)}</td><td>${String(use.count)}</td></tr>`,
  )
  .join('\n')}
</tbody>
</table>`;
}

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

export interface ReportLike {
  generatedAt: string;
  mode: string;
  findings: readonly Finding[];
  known?: readonly Finding[];
  allowed?: readonly AllowedUse[];
  counts: { errors: number; warnings: number };
  pages: readonly string[];
  dropped: number;
}

/** The report of one test as a page you can open from the Playwright report. */
export function renderHtml(report: ReportLike, title = 'Privacy guard report'): string {
  const known = report.known?.length ?? 0;
  const body = `<h1>${escapeHtml(title)}</h1>
<p class="muted">${escapeHtml(report.generatedAt)} · mode ${escapeHtml(report.mode)} · pages: ${
    report.pages.length === 0 ? 'none' : report.pages.map(escapeHtml).join(', ')
  }</p>
<div class="counts">
  <div class="count error"><b>${String(report.counts.errors)}</b>errors</div>
  <div class="count warn"><b>${String(report.counts.warnings)}</b>warnings</div>
  ${known > 0 ? `<div class="count"><b>${String(known)}</b>known (baseline)</div>` : ''}
</div>
${report.dropped > 0 ? `<p class="muted">${String(report.dropped)} observations were not kept because maxObservations was reached.</p>` : ''}
${renderGroups(report.findings)}
${renderAllowed(report.allowed ?? [])}`;
  return page(title, body);
}
