/**
 * runtime/weighted-health.ts — Phase 3g Wave B — runtime-weighted health score.
 *
 * Layers per-function execution evidence on top of the static score from
 * `health/score.ts`. The intuition: a function with sky-high cyclomatic
 * complexity that is never executed is a low refactor priority — dead code
 * cleanup will remove the complexity for free. A medium-complexity function
 * that's hammered in production is the real refactor target.
 *
 * Documented formula (committed to `weighted-health.test.ts` verbatim):
 *
 *   weight     = log10(1 + hits)
 *   adjusted   = cyclomatic * weight
 *
 * Aggregate per-file:
 *
 *   sumAdjusted = Σ adjusted[fn] over all functions in the file
 *   meanCog     = mean of fn.cognitive (unchanged from static MI scoring)
 *   meanMi      = mean of fn.maintainabilityIndex
 *   normCyc     = clamp((sumAdjusted / 30) * 100, 0, 100)
 *   normCog     = clamp((meanCog / 50) * 100, 0, 100)
 *   score       = round(
 *                   weights.cyclomatic * (100 - normCyc)
 *                 + weights.cognitive  * (100 - normCog)
 *                 + weights.mi         * meanMi
 *                 )
 *
 * Coverage missing for a function: hits = 0 → log10(1) = 0 → adjusted = 0.
 * That is exactly the behaviour requested by the spec (T171): high-CC zero-hit
 * functions become a low priority.
 */

import type { FileComplexity } from '@fugazi/extract';
import type { ScoreWeights } from '../health/types.js';
import type { CoverageIndex } from './types.js';

const DEFAULT_WEIGHTS: ScoreWeights = Object.freeze({
  cyclomatic: 0.3,
  cognitive: 0.3,
  mi: 0.4,
});

const CYCLOMATIC_NORM = 30;
const COGNITIVE_NORM = 50;

export interface WeightedScoreOptions {
  readonly weights?: ScoreWeights;
}

/**
 * Compute the runtime-weighted file score in `[0, 100]`. Higher is better.
 *
 *   - `fc`        FileComplexity for the file.
 *   - `coverage`  CoverageIndex; if a function has no entry, hits = 0.
 *   - `filePath`  Absolute POSIX path the file is keyed under in `coverage`.
 *                 Used to look up `coverage.byFunction.get('${filePath}::${name}')`.
 */
export function computeWeightedFileScore(
  fc: FileComplexity,
  coverage: CoverageIndex,
  filePath: string,
  options: WeightedScoreOptions = {},
): number {
  const w = options.weights ?? DEFAULT_WEIGHTS;
  const fns = fc.functions;

  let sumAdjusted = 0;
  let cogSum = 0;
  let miSum = 0;
  for (const fn of fns) {
    const hits = lookupHits(coverage, filePath, fn.name);
    const weight = Math.log10(1 + hits);
    sumAdjusted += fn.cyclomatic * weight;
    cogSum += fn.cognitive;
    miSum += fn.maintainabilityIndex;
  }
  const count = fns.length;
  const meanCog = count > 0 ? cogSum / count : 0;
  const meanMi = count > 0 ? miSum / count : 100;

  const normCyc = clamp((sumAdjusted / CYCLOMATIC_NORM) * 100, 0, 100);
  const normCog = clamp((meanCog / COGNITIVE_NORM) * 100, 0, 100);

  const raw =
    w.cyclomatic * (100 - normCyc) + w.cognitive * (100 - normCog) + w.mi * clamp(meanMi, 0, 100);

  if (!Number.isFinite(raw)) return 100;
  const rounded = Math.round(raw);
  if (rounded < 0) return 0;
  if (rounded > 100) return 100;
  return rounded;
}

function lookupHits(coverage: CoverageIndex, filePath: string, fnName: string): number {
  const entry = coverage.byFunction.get(`${filePath}::${fnName}`);
  if (entry === undefined) return 0;
  let total = 0;
  for (const r of entry.ranges) total += r.count;
  return total;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return hi;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
