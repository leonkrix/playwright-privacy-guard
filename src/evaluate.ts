import { withoutAwayPages } from './away.js';
import type { Context } from './context.js';
import {
  apisRule,
  cookiesRule,
  cspQualityRule,
  cspRule,
  errorsRule,
  fingerprintRule,
  formsRule,
  headersRule,
  insecureRule,
  leaksRule,
  referrerRule,
  requestsRule,
  sriRule,
  storageRule,
} from './rules.js';
import { type Finding, RULE_IDS, type Observation, type StateSnapshot } from './types.js';

/** The order in the report: what fails first, then the rule order, then what happened most. */
export function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort((a, b) => {
    if (a.level !== b.level) {
      return a.level === 'error' ? -1 : 1;
    }
    const byRule = RULE_IDS.indexOf(a.rule) - RULE_IDS.indexOf(b.rule);
    return byRule !== 0 ? byRule : b.count - a.count || a.subject.localeCompare(b.subject);
  });
}

/**
 * Looks at everything that was seen and says what is wrong. A pure function: the same observations
 * and options always give the same findings.
 */
export function evaluate(
  all: readonly Observation[],
  state: StateSnapshot | undefined,
  context: Context,
): Finding[] {
  const { observations, snapshot } = withoutAwayPages(all, state, context);
  return sortFindings([
    ...requestsRule(observations, context),
    ...insecureRule(observations, context),
    ...cookiesRule(observations, snapshot, context),
    ...storageRule(observations, snapshot, context),
    ...cspRule(observations, context),
    ...errorsRule(observations, context),
    ...apisRule(observations, context),
    ...fingerprintRule(observations, context),
    ...formsRule(observations, context),
    ...referrerRule(observations, context),
    ...sriRule(observations, context),
    ...leaksRule(observations, context),
    ...headersRule(observations, context),
    ...cspQualityRule(observations, context),
  ]);
}
