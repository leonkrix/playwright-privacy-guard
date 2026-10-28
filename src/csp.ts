/** A Content Security Policy as a list of directives, each with its sources. */
export type Policy = Map<string, string[]>;

/** Reads a policy: `default-src 'self'; img-src 'self' data:` */
export function parsePolicy(text: string): Policy {
  const policy: Policy = new Map();
  for (const part of text.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name !== undefined && name !== '' && !policy.has(name.toLowerCase())) {
      policy.set(name.toLowerCase(), sources);
    }
  }
  return policy;
}

export interface PolicyIssue {
  /** Short: `script-src allows 'unsafe-inline'` */
  subject: string;
  /** What it means and what to do */
  summary: string;
}

const has = (sources: readonly string[], keyword: string): boolean =>
  sources.some((source) => source.toLowerCase() === `'${keyword}'`);

const hasNonceOrHash = (sources: readonly string[]): boolean =>
  sources.some((source) => /^'(nonce-|sha(256|384|512)-)/i.test(source));

/**
 * What is weak about a policy. The checks follow what browsers do with it: `'unsafe-inline'` is
 * ignored when a nonce or a hash is there, `'strict-dynamic'` makes host lists meaningless, and a
 * directive that is missing falls back to `default-src` (but `base-uri` and `frame-ancestors` do not).
 */
export function checkPolicy(policy: Policy, options: { meta: boolean }): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  const fallback = policy.get('default-src');
  const scripts = policy.get('script-src') ?? fallback;
  const scriptName = policy.has('script-src') ? 'script-src' : 'default-src';
  if (scripts === undefined) {
    issues.push({
      subject: 'no script-src or default-src',
      summary: 'scripts can come from anywhere: add default-src or script-src',
    });
  } else {
    if (
      has(scripts, 'unsafe-inline') &&
      !hasNonceOrHash(scripts) &&
      !has(scripts, 'strict-dynamic')
    ) {
      issues.push({
        subject: `${scriptName} allows 'unsafe-inline'`,
        summary:
          'any inline script runs, so an injected one does too: use nonces or hashes instead',
      });
    }
    if (has(scripts, 'unsafe-eval')) {
      issues.push({
        subject: `${scriptName} allows 'unsafe-eval'`,
        summary: 'eval() and similar functions are allowed: a common step of an attack',
      });
    }
    if (!has(scripts, 'strict-dynamic')) {
      const wide = scripts.filter((source) => /^(\*|https?:|data:|blob:)$/i.test(source));
      if (wide.length > 0) {
        issues.push({
          subject: `${scriptName} allows ${wide.join(' ')}`,
          summary: 'scripts from any host of that kind run: name the hosts you need',
        });
      }
    }
  }
  const objects = policy.get('object-src') ?? fallback;
  if (objects === undefined || (!has(objects, 'none') && !has(objects, 'self'))) {
    issues.push({
      subject: 'object-src is not restricted',
      summary: "plugins can load from anywhere: add object-src 'none'",
    });
  }
  if (!policy.has('base-uri')) {
    issues.push({
      subject: 'base-uri is missing',
      summary:
        "an injected <base> tag can redirect relative links: add base-uri 'self' (or 'none')",
    });
  }
  if (!policy.has('frame-ancestors') && !options.meta) {
    issues.push({
      subject: 'frame-ancestors is missing',
      summary: "other sites can put the page in a frame: add frame-ancestors 'none' (or 'self')",
    });
  }
  return issues;
}
