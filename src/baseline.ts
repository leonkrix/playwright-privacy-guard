import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Finding } from './types.js';

/** What identifies a finding in the baseline: the rule, what it is about and the page. */
export interface BaselineEntry {
  rule: string;
  subject: string;
  page: string;
}

interface BaselineFile {
  version: 1;
  findings: BaselineEntry[];
}

export function keyOf(entry: BaselineEntry): string {
  return `${entry.rule}\n${entry.subject}\n${entry.page}`;
}

/** The entries of a baseline file; none when the file is not there yet. */
export function readBaseline(path: string): BaselineEntry[] {
  if (!existsSync(path)) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`privacy-guard: the baseline ${path} is not valid JSON`);
  }
  const list = (parsed as Partial<BaselineFile> | null)?.findings;
  if (!Array.isArray(list)) {
    throw new Error(`privacy-guard: the baseline ${path} has no "findings" list`);
  }
  return list.filter(
    (entry): entry is BaselineEntry =>
      typeof entry === 'object' &&
      typeof (entry as Partial<BaselineEntry>).rule === 'string' &&
      typeof (entry as Partial<BaselineEntry>).subject === 'string' &&
      typeof (entry as Partial<BaselineEntry>).page === 'string',
  );
}

/** Adds findings to the baseline file (the file is written sorted, so a diff in a review is small). */
export function addToBaseline(path: string, findings: readonly Finding[]): void {
  const known = new Map<string, BaselineEntry>();
  for (const entry of [...readBaseline(path), ...findings]) {
    const slim = { rule: entry.rule, subject: entry.subject, page: entry.page };
    known.set(keyOf(slim), slim);
  }
  const sorted = [...known.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  mkdirSync(dirname(path), { recursive: true });
  const file: BaselineFile = { version: 1, findings: sorted };
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
}

/** Splits findings into the ones the baseline knows and the new ones. */
export function splitByBaseline(
  findings: readonly Finding[],
  path: string | undefined,
): { known: Finding[]; fresh: Finding[] } {
  if (path === undefined) {
    return { known: [], fresh: [...findings] };
  }
  const keys = new Set(readBaseline(path).map(keyOf));
  return {
    known: findings.filter((found) => keys.has(keyOf(found))),
    fresh: findings.filter((found) => !keys.has(keyOf(found))),
  };
}
