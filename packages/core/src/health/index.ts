/**
 * health/index.ts — Phase 3f.5 barrel.
 *
 * Re-exports the scoring API used by the `--score` CLI flag and any
 * programmatic consumer. The rule layer (`complexity-hotspot`,
 * `cognitive-complexity`) does NOT route through here — it consumes
 * `FileComplexity` directly from `@fugazi/extract` via the RuleContext.
 */

export {
  computeFileScore,
  computeProjectScore,
  computeRefactorTargets,
  formatScoreLine,
} from './score.js';
export type { HealthScore, RefactorTarget, ScoreWeights } from './types.js';
