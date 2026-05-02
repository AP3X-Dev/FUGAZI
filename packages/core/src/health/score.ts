/**
 * health/score.ts — Phase 3f.5 (T164) — `--score` API surface.
 *
 * Pure scoring helpers consumed by the (not-yet-wired) `--score` CLI flag.
 * No diagnostics are emitted here — the rule layer
 * (`complexity-hotspot`, `cognitive-complexity`) handles Issue emission; this
 * module is the parallel scoring path.
 *
 * Score formula (per spec):
 *
 *   normCyc  = clamp((cyclomatic / 30) * 100, 0, 100)
 *   normCog  = clamp((cognitive  / 50) * 100, 0, 100)
 *   score    = round(
 *                weights.cyclomatic * (100 - normCyc)
 *              + weights.cognitive  * (100 - normCog)
 *              + weights.mi         * maintainabilityIndex
 *              )
 *
 * Default weights: `{ cyclomatic: 0.3, cognitive: 0.3, mi: 0.4 }` (sum to 1).
 *
 * Edge cases (per IMP-CORRECT-09 / FR-G3):
 *
 *   - LOC=0, HV=0, CC=0 inside `FileComplexity` already yield finite values
 *     because `computeMi` clamps. If for any reason a NaN/Infinity is
 *     produced, we coerce to 100 (best-case) so reporters never see NaN.
 */

import type { FileComplexity } from '@fugazi/extract';
import type { HealthScore, RefactorTarget, ScoreWeights } from './types.js';

const DEFAULT_WEIGHTS: ScoreWeights = Object.freeze({
  cyclomatic: 0.3,
  cognitive: 0.3,
  mi: 0.4,
});

/** Cyclomatic normalization divisor — 30 maps to a 100-point scale. */
const CYCLOMATIC_NORM = 30;
/** Cognitive normalization divisor — 50 maps to a 100-point scale. */
const COGNITIVE_NORM = 50;

/**
 * Compute the integer health score in `[0, 100]` for a single file.
 * Higher is better. NaN/Infinity inputs are clamped to 100.
 */
export function computeFileScore(fc: FileComplexity, weights?: ScoreWeights): number {
  const w = weights ?? DEFAULT_WEIGHTS;
  const cyc = fc.aggregate.cyclomatic;
  const cog = fc.aggregate.cognitive;
  const mi = fc.aggregate.maintainabilityIndex;

  const normCyc = clamp((cyc / CYCLOMATIC_NORM) * 100, 0, 100);
  const normCog = clamp((cog / COGNITIVE_NORM) * 100, 0, 100);

  const raw =
    w.cyclomatic * (100 - normCyc) + w.cognitive * (100 - normCog) + w.mi * clamp(mi, 0, 100);

  if (!Number.isFinite(raw)) return 100;
  const rounded = Math.round(raw);
  if (rounded < 0) return 0;
  if (rounded > 100) return 100;
  return rounded;
}

/**
 * Mean of per-file scores, rounded. Empty input yields 100 (a project with
 * zero files cannot have negative health).
 */
export function computeProjectScore(perFile: ReadonlyMap<string, HealthScore>): number {
  if (perFile.size === 0) return 100;
  let sum = 0;
  for (const score of perFile.values()) {
    sum += score.score;
  }
  const mean = sum / perFile.size;
  if (!Number.isFinite(mean)) return 100;
  return Math.round(mean);
}

/**
 * Top-K refactor candidates ordered ascending by score (worst-first); ties
 * broken by lex-asc file path. Returns at most `k` entries (default 10).
 */
export function computeRefactorTargets(
  perFile: ReadonlyMap<string, HealthScore>,
  k = 10,
): readonly RefactorTarget[] {
  if (k <= 0) return [];
  const arr: RefactorTarget[] = [];
  for (const score of perFile.values()) {
    arr.push(Object.freeze({ file: score.file, score: score.score }));
  }
  arr.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    return 0;
  });
  return Object.freeze(arr.slice(0, k));
}

/**
 * Single-line stdout format used by the `--score` flag: just the integer
 * followed by a newline.
 */
export function formatScoreLine(score: number): string {
  return `${score}\n`;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return hi;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
