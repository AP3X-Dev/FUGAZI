/**
 * runtime/index.ts — Phase 3g Wave A — internal barrel.
 *
 * Re-exports the Wave A surface (detector cores + their finding shapes) for
 * consumption by Wave B's orchestrator. NOT re-exported from `@fugazi/core`'s
 * public `index.ts` until Wave B finalizes the contract — see the spec.
 */

export { buildCoverageIndex } from './coverage-shape.js';
export { findColdCode, type FindColdCodeResult } from './cold-code.js';
export { findHotPaths } from './hot-path.js';
export {
  rebaseCoverageAuto,
  type RebaseAutoExplicit,
  type RebaseAutoOptions,
  type RebaseMode,
} from './coverage-rebase.js';
export {
  validateColumnTolerance,
  type ValidateColumnToleranceOptions,
} from './vitest-tolerance.js';
export {
  computeWeightedFileScore,
  type WeightedScoreOptions,
} from './weighted-health.js';
export { emptyRuntimeReport, type RuntimeReport } from './runtime-report.js';
export { runRuntime, type RunRuntimeOptions } from './run-runtime.js';
export type {
  ColdCodeFinding,
  CoverageByFile,
  CoverageByFunction,
  CoverageIndex,
  FindColdCodeOptions,
  FindHotPathsOptions,
  HotPathFinding,
} from './types.js';
