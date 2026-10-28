export { expect } from '@playwright/test';
export { allowHint, describeFinding, formatFindings } from './format.js';
export { test, type PrivacyGuardFixtures } from './fixture.js';
export { installPrivacyGuard, type PrivacyGuard, type PrivacyReport } from './install.js';
export { DEFAULT_LEVELS as privacyGuardDefaultLevels, mergeAllow } from './options.js';
export { trackerOf } from './trackers.js';
export {
  API_NAMES,
  FINGERPRINT_NAMES,
  type FingerprintName,
  type Allow,
  type ApiName,
  type Entry,
  type Finding,
  type HeaderPreset,
  type HeaderRule,
  type HeaderRules,
  type Level,
  type PrivacyGuardOptions,
  type PrivacyGuardTestOptions,
  RULE_IDS,
  type RuleId,
  type Source,
  type Tracker,
} from './types.js';
