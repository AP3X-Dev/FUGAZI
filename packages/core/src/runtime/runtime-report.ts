/**
 * runtime/runtime-report.ts — Phase 3g Wave B — `RuntimeReport` schema + builder.
 *
 * The runtime layer produces a `RuntimeReport` distinct from the static
 * `RunAnalysisResult.issues` stream. Reasoning (per T178): hot-path and
 * cold-code findings need access to coverage data which the rule registry
 * doesn't carry; surfacing them as a sibling report keeps `RuleContext` clean
 * and lets the Phase 3h reporter map findings → DiscriminatedIssue at the
 * presentation layer.
 *
 * Determinism (NFR-1 / SC-15): every nested array is sorted at construction
 * time and the returned report is deeply frozen. JSON.stringify(report) is
 * byte-equal across runs given identical inputs.
 */

import type { RefactorTarget } from '../health/types.js';
import type { ColdCodeFinding, HotPathFinding } from './types.js';

export interface RuntimeReport {
  readonly schemaVersion: 1;
  readonly hotPaths: readonly HotPathFinding[];
  readonly coldCode: readonly ColdCodeFinding[];
  readonly coverageMissing: readonly string[];
  readonly weightedRefactorTargets: readonly RefactorTarget[];
}

/**
 * Frozen empty `RuntimeReport`. Returned by `runRuntime` when no scripts
 * survive the rebase + module-filter pipeline.
 */
export function emptyRuntimeReport(): RuntimeReport {
  return Object.freeze({
    schemaVersion: 1,
    hotPaths: Object.freeze([] as readonly HotPathFinding[]),
    coldCode: Object.freeze([] as readonly ColdCodeFinding[]),
    coverageMissing: Object.freeze([] as readonly string[]),
    weightedRefactorTargets: Object.freeze([] as readonly RefactorTarget[]),
  }) satisfies RuntimeReport;
}
