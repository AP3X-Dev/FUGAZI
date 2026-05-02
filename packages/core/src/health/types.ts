/**
 * health/types.ts — Phase 3f.5 (T164) — internal health-score shapes.
 *
 * The `--score` CLI flag (not yet wired) consumes `HealthScore` per file and
 * collapses them into a project score + a top-K refactor-targets list. These
 * types are kept in their own module so the rule layer (`complexity-hotspot`,
 * `cognitive-complexity`) can stay lean and only depend on `FileComplexity`.
 *
 * Both shapes are deeply readonly to satisfy NFR-1 / FR-I1 — no consumer can
 * mutate scoring output between scoring and reporting.
 */

/**
 * `HealthScore` — per-file scoring snapshot.
 *
 *   - `file`                 absolute POSIX path the score belongs to.
 *   - `score`                weighted integer in `[0, 100]`. 100 is best.
 *   - `cyclomatic`           file-level cyclomatic sum (mirrors
 *                            `FileComplexity.aggregate.cyclomatic`).
 *   - `cognitive`            file-level cognitive sum.
 *   - `maintainabilityIndex` file-level mean MI (already in `[0, 100]`).
 */
export interface HealthScore {
  readonly file: string;
  readonly score: number;
  readonly cyclomatic: number;
  readonly cognitive: number;
  readonly maintainabilityIndex: number;
}

/**
 * `RefactorTarget` — a refactor candidate emitted by
 * `computeRefactorTargets`. The list is sorted ascending by `score` (worst
 * first); ties are broken lex-ascending on `file`.
 */
export interface RefactorTarget {
  readonly file: string;
  readonly score: number;
}

/**
 * Per-metric weighting for the file-level score. Defaults applied at the
 * scoring layer: `{ cyclomatic: 0.3, cognitive: 0.3, mi: 0.4 }`.
 */
export interface ScoreWeights {
  readonly cyclomatic: number;
  readonly cognitive: number;
  readonly mi: number;
}
