import type { AllowKey, AllowedUse, Finding, RuleId } from './types.js';

const TITLES: Record<RuleId, string> = {
  requests: 'Requests to other origins',
  insecure: 'Requests without encryption',
  cookies: 'Cookies',
  cookieAttributes: 'Weak attributes of allowed cookies',
  storage: 'Data stored on the device',
  csp: 'Content Security Policy violations',
  errors: 'Errors',
  apis: 'Sensitive browser APIs',
  forms: 'Forms and links that send data to other origins',
  referrer: 'Full page address sent as referrer',
  sri: 'Scripts and styles without integrity',
  leaks: 'Values that reached a third party',
  headers: 'Response headers',
  cspQuality: 'Weak Content Security Policy',
  fingerprint: 'Fingerprinting',
};

export function titleOf(rule: RuleId): string {
  return TITLES[rule];
}

/** `Google Analytics, analytics` */
export function describeTracker(finding: Finding): string | undefined {
  return finding.tracker === undefined
    ? undefined
    : `${finding.tracker.entity}, ${finding.tracker.category}`;
}

const INDENT = '    ';

/** One finding as lines: the subject, who it is, what happened, where it came from. */
export function describeFinding(finding: Finding): string[] {
  const tracker = describeTracker(finding);
  const mark = finding.level === 'warn' ? '(warning) ' : '';
  const head = `  - ${mark}${finding.subject}${tracker === undefined ? '' : `  [${tracker}]`}`;
  return [
    head,
    `${INDENT}${finding.summary}`,
    ...finding.details.map((line) => `${INDENT}${line}`),
  ];
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** The part of the options that would allow what was found, as code to copy. */
export function allowHint(findings: readonly Finding[]): string[] {
  const byKey = new Map<AllowKey, string[]>();
  for (const found of findings) {
    if (found.allow === undefined) {
      continue;
    }
    const list = byKey.get(found.allow.key) ?? [];
    if (!list.includes(found.allow.value)) {
      list.push(found.allow.value);
    }
    byKey.set(found.allow.key, list);
  }
  if (byKey.size === 0) {
    return [];
  }
  const lines = [...byKey.entries()].map(([key, values]) =>
    key === 'serviceWorkers'
      ? `${INDENT}${key}: true,`
      : `${INDENT}${key}: [${values.map(quote).join(', ')}],`,
  );
  return ['  allow: {', ...lines, '  },'];
}

/** What the allow entries let pass on purpose, as lines to append to a report (empty when nothing). */
export function formatAllowed(allowed: readonly AllowedUse[]): string {
  if (allowed.length === 0) {
    return '';
  }
  const lines = ['', '', `Allowed on purpose (${String(allowed.length)})`];
  for (const use of allowed) {
    const times = use.count > 1 ? ` (${String(use.count)}x)` : '';
    lines.push(`  - ${TITLES[use.rule]}: ${use.what}${times}`);
    lines.push(`${INDENT}allowed by: ${use.entry}`);
    lines.push(`${INDENT}reason: ${use.reason ?? 'none given'}`);
  }
  return lines.join('\n');
}

/** The pages the findings were seen on */
function pagesOf(findings: readonly Finding[]): string {
  const pages = [...new Set(findings.map((found) => found.page).filter((page) => page !== ''))];
  if (pages.length === 0) {
    return '';
  }
  const shown = pages.slice(0, 3).join(', ');
  return ` on ${shown}${pages.length > 3 ? ` and ${String(pages.length - 3)} more` : ''}`;
}

/** The message of a failed test (and the text of the report). */
export function formatFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) {
    return 'Privacy guard: nothing found.';
  }
  const errors = findings.filter((found) => found.level === 'error').length;
  const warnings = findings.length - errors;
  const counts = [
    errors > 0 ? `${String(errors)} ${errors === 1 ? 'error' : 'errors'}` : '',
    warnings > 0 ? `${String(warnings)} ${warnings === 1 ? 'warning' : 'warnings'}` : '',
  ].filter((part) => part !== '');
  const lines = [
    `Privacy guard: ${String(findings.length)} ${findings.length === 1 ? 'problem' : 'problems'} (${counts.join(', ')})${pagesOf(findings)}`,
  ];
  const rules = [...new Set(findings.map((found) => found.rule))];
  for (const rule of rules) {
    const own = findings.filter((found) => found.rule === rule);
    lines.push('', `${TITLES[rule]} (${String(own.length)})`);
    for (const found of own) {
      lines.push(...describeFinding(found));
    }
  }
  const hint = allowHint(findings);
  lines.push('');
  if (hint.length > 0) {
    lines.push(
      'If this is meant, allow it where the guard is set up (the reason helps the next reader: { match: ..., reason: ... }):',
      '',
      '  privacyGuard: {',
      ...hint.map((line) => `  ${line}`),
      '  }',
      '',
    );
  }
  lines.push(
    'Other ways: switch a rule off with rules: { <rule>: "off" } (or "warn"), switch the guard off for a test with',
    'test.use({ privacyGuard: false }), or only look with mode: "report".',
  );
  return lines.join('\n');
}
