/**
 * cross-ref.ts — Phase 3f.6 (T166) — file-level finding short-circuit.
 *
 * Per §4.B.5: when `unused-files` flags a file, every per-export finding on
 * that same file is redundant — the parent file is already known dead, so the
 * exports it carries are dead by transitivity. This filter trims those
 * downstream findings before sort + emit.
 *
 * The filter runs O(N) over the issue list:
 *   1. Collect the set of paths flagged `unused-files` into a `Set<string>`.
 *   2. Walk the issue list once; drop any `unused-exports` / `unused-types` /
 *      `unused-enum-members` / `unused-class-members` whose `file` is in that
 *      set. Other rule kinds pass through.
 *
 * Synchronous. Pure. Never throws. Input is not mutated.
 */

import type { DiscriminatedIssue, RuleId } from '@fugazi/types';

/**
 * Rule kinds that are short-circuited by an `unused-files` finding on the
 * same path. The list is closed; adding a kind here is a deliberate change
 * to the cross-reference contract.
 */
const SHORT_CIRCUITED: ReadonlySet<RuleId> = new Set<RuleId>([
  'unused-exports',
  'unused-types',
  'unused-enum-members',
  'unused-class-members',
]);

export interface CrossReferenceResult {
  /** The filtered issue list — same order as input minus suppressed entries. */
  readonly issues: readonly DiscriminatedIssue[];
  /** The set of paths that triggered short-circuiting (for observability). */
  readonly shortCircuitedPaths: ReadonlySet<string>;
  /** Count of issues filtered out, partitioned by RuleId. */
  readonly filteredByRule: Readonly<Partial<Record<RuleId, number>>>;
}

/**
 * Apply the `§4.B.5` cross-reference filter to a sorted issue list.
 *
 * The walk is single-pass: one iteration to collect orphan paths, one to
 * filter. Nothing else is reordered — the caller already sorted the input.
 */
export function applyCrossReferenceFilter(
  issues: readonly DiscriminatedIssue[],
): CrossReferenceResult {
  const orphanPaths = new Set<string>();
  for (const issue of issues) {
    if (issue.kind === 'unused-files') {
      orphanPaths.add(issue.file);
    }
  }

  if (orphanPaths.size === 0) {
    return {
      issues,
      shortCircuitedPaths: orphanPaths,
      filteredByRule: Object.freeze({}),
    };
  }

  const kept: DiscriminatedIssue[] = [];
  const filtered: Partial<Record<RuleId, number>> = {};
  for (const issue of issues) {
    if (SHORT_CIRCUITED.has(issue.kind) && orphanPaths.has(issue.file)) {
      filtered[issue.kind] = (filtered[issue.kind] ?? 0) + 1;
      continue;
    }
    kept.push(issue);
  }

  return {
    issues: kept,
    shortCircuitedPaths: orphanPaths,
    filteredByRule: Object.freeze(filtered),
  };
}
