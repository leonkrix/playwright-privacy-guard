import { parsePolicy } from './csp.js';
import type { HeaderPreset, HeaderRule, HeaderRules } from './types.js';

export interface HeaderIssue {
  /** `header strict-transport-security` */
  subject: string;
  summary: string;
}

/** What `headers: { preset }` stands for. A function gets all headers and says what is wrong. */
type Check = (
  headers: Record<string, string>,
  page: { secure: boolean; metaPolicy: boolean },
) => HeaderIssue[];

const issue = (name: string, summary: string): HeaderIssue => ({
  subject: `header ${name}`,
  summary,
});

const strictTransport: Check = (headers, page) => {
  if (!page.secure) {
    return [];
  }
  const value = headers['strict-transport-security'];
  if (value === undefined) {
    return [
      issue('strict-transport-security', 'missing: browsers may use http for the next visit'),
    ];
  }
  const age = /max-age\s*=\s*(\d+)/i.exec(value);
  if (age === null || Number(age[1]) < 15_552_000) {
    return [
      issue('strict-transport-security', `max-age is too short (${value}): use at least 180 days`),
    ];
  }
  return [];
};

const noSniff: Check = (headers) =>
  headers['x-content-type-options']?.toLowerCase() === 'nosniff'
    ? []
    : [
        issue(
          'x-content-type-options',
          'should be nosniff, so that the browser does not guess types',
        ),
      ];

const referrer: Check = (headers) => {
  const value = headers['referrer-policy']?.toLowerCase();
  if (value === undefined) {
    return [
      issue(
        'referrer-policy',
        'missing: set it (strict-origin-when-cross-origin is the browser default, a header makes it certain)',
      ),
    ];
  }
  const last = value.split(',').pop()?.trim() ?? '';
  return ['unsafe-url', 'no-referrer-when-downgrade', 'origin-when-cross-origin'].includes(last)
    ? [issue('referrer-policy', `${last} sends more than needed to other sites`)]
    : [];
};

const framing: Check = (headers) => {
  const ancestors = parsePolicy(headers['content-security-policy'] ?? '').has('frame-ancestors');
  return ancestors || headers['x-frame-options'] !== undefined
    ? []
    : [
        issue(
          'x-frame-options',
          'missing, and no frame-ancestors in the policy: other sites can frame the page (clickjacking)',
        ),
      ];
};

const policy: Check = (headers, page) =>
  headers['content-security-policy'] !== undefined || page.metaPolicy
    ? []
    : [issue('content-security-policy', 'missing: no policy limits what the page may load')];

const leaks: Check = (headers) => [
  ...(headers['x-powered-by'] === undefined
    ? []
    : [
        issue('x-powered-by', `tells what runs the server (${headers['x-powered-by']}): remove it`),
      ]),
  ...(headers.server !== undefined && /\d/.test(headers.server)
    ? [
        issue(
          'server',
          `names a version (${headers.server}): it helps whoever looks for known flaws`,
        ),
      ]
    : []),
];

const permissions: Check = (headers) =>
  headers['permissions-policy'] === undefined
    ? [issue('permissions-policy', 'missing: switch off the features the page does not use')]
    : [];

const opener: Check = (headers) =>
  headers['cross-origin-opener-policy'] === undefined
    ? [
        issue(
          'cross-origin-opener-policy',
          'missing: same-origin separates the page from windows of other sites',
        ),
      ]
    : [];

export const PRESETS: Record<HeaderPreset, readonly Check[]> = {
  recommended: [strictTransport, noSniff, referrer, framing, policy, leaks],
  strict: [strictTransport, noSniff, referrer, framing, policy, leaks, permissions, opener],
};

/** One header against one rule of your own. */
function checkRule(name: string, rule: HeaderRule, value: string | undefined): HeaderIssue[] {
  const lower = name.toLowerCase();
  if (typeof rule === 'function') {
    const result = rule(value);
    if (result === true) {
      return [];
    }
    return [issue(lower, typeof result === 'string' ? result : 'does not meet the rule')];
  }
  if (rule instanceof RegExp) {
    rule.lastIndex = 0;
    return value !== undefined && rule.test(value)
      ? []
      : [issue(lower, value === undefined ? 'missing' : `${value} does not match ${String(rule)}`)];
  }
  if (rule === 'absent') {
    return value === undefined ? [] : [issue(lower, `is set (${value}) but must not be`)];
  }
  if (rule === 'present') {
    return value === undefined ? [issue(lower, 'missing')] : [];
  }
  if (value === undefined) {
    return [issue(lower, `missing (expected ${rule})`)];
  }
  return value.toLowerCase() === rule.toLowerCase()
    ? []
    : [issue(lower, `is ${value} but should be ${rule}`)];
}

/** What is wrong with the headers of a document, by the preset and by your own rules. */
export function checkHeaders(
  headers: Record<string, string>,
  page: { secure: boolean; metaPolicy: boolean },
  config: { preset: HeaderPreset | undefined; rules: HeaderRules | undefined },
): HeaderIssue[] {
  const issues: HeaderIssue[] = [];
  for (const check of config.preset === undefined ? [] : PRESETS[config.preset]) {
    issues.push(...check(headers, page));
  }
  for (const [name, rule] of Object.entries(config.rules ?? {})) {
    issues.push(...checkRule(name, rule, headers[name.toLowerCase()]));
  }
  return issues;
}
