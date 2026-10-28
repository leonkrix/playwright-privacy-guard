import type { Page } from '@playwright/test';

import type { Finding, RuleId } from '../src/index.js';

/** The other origin of the test server: a different host, so another origin */
export const OTHER = 'http://localhost:4411';

/** Opens a page and waits until it has finished loading and stopped asking for more. */
export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

/** The findings of one rule */
export function ofRule(findings: readonly Finding[], rule: RuleId): Finding[] {
  return findings.filter((found) => found.rule === rule);
}

/** Their subjects, sorted, for a short comparison */
export function subjects(findings: readonly Finding[], rule: RuleId): string[] {
  return ofRule(findings, rule)
    .map((found) => found.subject)
    .sort();
}
