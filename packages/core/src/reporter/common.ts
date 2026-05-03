/**
 * reporter/common.ts — Phase 3j — shared formatting helpers used by every
 * concrete reporter implementation.
 *
 * Pure functions only. No I/O, no environment access, no `Date.now()`,
 * `Math.random()`, or other non-deterministic source. Tests assert byte-equal
 * output across 50 iterations on a shuffled input list, so any non-determinism
 * here is a bug.
 */

import { createHash } from 'node:crypto';
import type { DiscriminatedIssue, Range, Severity } from '@fugazi/types';

/**
 * Deterministic comparator over `(file, line, col, ruleId, message)`. The
 * driver already sorts before reaching the reporter, but every reporter does a
 * defensive re-sort so reporter input ordering is irrelevant to output (NFR-1).
 */
export function compareIssues(a: DiscriminatedIssue, b: DiscriminatedIssue): number {
  const fa = a.file;
  const fb = b.file;
  if (fa < fb) return -1;
  if (fa > fb) return 1;
  const la = a.range?.start.line ?? 0;
  const lb = b.range?.start.line ?? 0;
  if (la !== lb) return la - lb;
  const ca = a.range?.start.column ?? 0;
  const cb = b.range?.start.column ?? 0;
  if (ca !== cb) return ca - cb;
  if (a.kind < b.kind) return -1;
  if (a.kind > b.kind) return 1;
  if (a.message < b.message) return -1;
  if (a.message > b.message) return 1;
  return 0;
}

/** Return a sorted shallow copy of the issue list. */
export function sortIssues(issues: readonly DiscriminatedIssue[]): DiscriminatedIssue[] {
  return [...issues].sort(compareIssues);
}

/**
 * Best-effort project-relative path. Strips a `projectRoot` prefix when the
 * file is inside it; otherwise returns the absolute path unchanged. Forward
 * slashes are normalized so output is identical on Windows and POSIX.
 */
export function relPath(file: string, projectRoot: string | undefined): string {
  const norm = file.replace(/\\/g, '/');
  if (projectRoot === undefined || projectRoot.length === 0) return norm;
  const rootNorm = projectRoot.replace(/\\/g, '/').replace(/\/+$/u, '');
  if (rootNorm.length === 0) return norm;
  if (norm === rootNorm) return '.';
  const prefix = `${rootNorm}/`;
  if (norm.startsWith(prefix)) return norm.slice(prefix.length);
  return norm;
}

/** 1-indexed start line, defaulting to `1` when the issue has no range. */
export function startLine(issue: DiscriminatedIssue): number {
  return issue.range?.start.line ?? 1;
}

/** 1-indexed start column, defaulting to `1` when the issue has no range. */
export function startColumn(issue: DiscriminatedIssue): number {
  // Range column is 0-based UTF-16 (LSP convention); reporters emit 1-indexed.
  const col = issue.range?.start.column;
  if (col === undefined) return 1;
  return col + 1;
}

/** 1-indexed end line; falls back to `startLine` when range is absent. */
export function endLine(issue: DiscriminatedIssue): number {
  return issue.range?.end.line ?? startLine(issue);
}

/** 1-indexed end column; falls back to `startColumn` when range is absent. */
export function endColumn(issue: DiscriminatedIssue): number {
  const col = issue.range?.end.column;
  if (col === undefined) return startColumn(issue);
  return col + 1;
}

/** Map our Severity ('error' | 'warn' | 'off') to a wire-format token. */
export function severityWire(s: Severity): 'error' | 'warning' | 'note' {
  if (s === 'error') return 'error';
  if (s === 'warn') return 'warning';
  return 'note';
}

/** SARIF level uses the same vocabulary as severityWire. */
export function sarifLevel(s: Severity): 'error' | 'warning' | 'note' {
  return severityWire(s);
}

/** Code Climate severity ladder. */
export function ccSeverity(s: Severity): 'major' | 'minor' | 'info' {
  if (s === 'error') return 'major';
  if (s === 'warn') return 'minor';
  return 'info';
}

/** Code Climate category by rule kind. */
export function ccCategory(kind: DiscriminatedIssue['kind']): string {
  switch (kind) {
    case 'code-duplication':
    case 'duplicate-exports':
      return 'Duplication';
    case 'complexity-hotspot':
    case 'cognitive-complexity':
      return 'Complexity';
    case 'boundary-violations':
      return 'Style';
    default:
      return 'Bug Risk';
  }
}

/**
 * Section discriminator. Reporters group issues into sections in this order:
 *   1. dead-code
 *   2. duplicates
 *   3. health
 *   4. runtime
 */
export type Section = 'dead-code' | 'duplicates' | 'health' | 'runtime';

export function sectionOf(kind: DiscriminatedIssue['kind']): Section {
  switch (kind) {
    case 'unused-files':
    case 'unused-exports':
    case 'unused-types':
    case 'unused-deps':
    case 'unused-dev-deps':
    case 'unused-optional-deps':
    case 'unused-enum-members':
    case 'unused-class-members':
    case 'circular-dependencies':
    case 'boundary-violations':
    case 'unresolved-imports':
    case 'unlisted-dependencies':
    case 'private-type-leak':
      return 'dead-code';
    case 'duplicate-exports':
    case 'code-duplication':
      return 'duplicates';
    case 'complexity-hotspot':
    case 'cognitive-complexity':
      return 'health';
    case 'cold-code':
    case 'hot-path':
      return 'runtime';
  }
}

/**
 * sha1 hex digest. Used for Code Climate fingerprints. Pure deterministic
 * function of its input; no salt, no time.
 */
export function sha1Hex(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

/** Stable reduce: `Map<string, T[]>` keyed by `keyFn`, insertion-ordered. */
export function groupBy<T, K extends string>(
  items: readonly T[],
  keyFn: (item: T) => K,
): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const existing = out.get(k);
    if (existing) {
      existing.push(item);
    } else {
      out.set(k, [item]);
    }
  }
  return out;
}

/**
 * Range shape used in JSON output (1-indexed lines/columns).
 */
export interface JsonRange {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export function jsonRange(range: Range | undefined): JsonRange {
  if (range === undefined) {
    return { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 };
  }
  return {
    startLine: range.start.line,
    startColumn: range.start.column + 1,
    endLine: range.end.line,
    endColumn: range.end.column + 1,
  };
}

/**
 * Cross-platform LF newline. Reporters always emit LF; consumers handle their
 * own line-ending conversion if needed (NFR-1: byte-equal across platforms).
 */
export const LF = '\n';
