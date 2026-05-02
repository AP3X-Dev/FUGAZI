/**
 * weighted-health.test.ts — Phase 3g Wave B acceptance suite for
 * `computeWeightedFileScore`.
 *
 * Documented formula (verbatim — committed in this comment per spec T171):
 *
 *   weight     = log10(1 + hits)
 *   adjusted   = cyclomatic * weight
 *
 * Coverage missing for a function: hits = 0 → log10(1) = 0 → adjusted = 0
 * (high-CC zero-hit functions become a low priority, by design).
 */

import type { FileComplexity, FunctionComplexity } from '@fugazi/extract';
import type { FunctionCoverage, ScriptCoverage } from '@fugazi/v8-coverage';
import { describe, expect, it } from 'vitest';
import { buildCoverageIndex } from '../coverage-shape.js';
import { computeWeightedFileScore } from '../weighted-health.js';

function fnComplexity(
  name: string,
  cyclomatic: number,
  cognitive = 0,
  mi = 100,
): FunctionComplexity {
  return {
    name,
    cyclomatic,
    cognitive,
    maintainabilityIndex: mi,
    loc: 10,
    range: { start: { line: 1, col: 0, byteOffset: 0 }, end: { line: 1, col: 0, byteOffset: 1 } },
  };
}

function fc(fns: readonly FunctionComplexity[]): FileComplexity {
  let cyc = 0;
  let cog = 0;
  let miSum = 0;
  for (const f of fns) {
    cyc += f.cyclomatic;
    cog += f.cognitive;
    miSum += f.maintainabilityIndex;
  }
  const meanMi = fns.length === 0 ? 100 : miSum / fns.length;
  return {
    functions: fns,
    aggregate: {
      cyclomatic: cyc,
      cognitive: cog,
      maintainabilityIndex: meanMi,
      loc: 10 * fns.length,
    },
  };
}

function covFn(name: string, count: number): FunctionCoverage {
  return {
    functionName: name,
    isBlockCoverage: false,
    ranges: [{ startOffset: 0, endOffset: 10, count }],
  };
}

function script(url: string, fns: readonly FunctionCoverage[]): ScriptCoverage {
  return { scriptId: '1', url, functions: fns };
}

describe('computeWeightedFileScore', () => {
  it('high-CC zero-hit function → low weighted CC contribution → high score', () => {
    // CC=20, hits=0 → adjusted = 20 * log10(1) = 0. So normCyc = 0, score is
    // dominated by MI (which is 100) → score ≈ 100.
    const file = '/proj/dead.ts';
    const idx = buildCoverageIndex([script(file, [covFn('cold', 0)])]);
    const score = computeWeightedFileScore(fc([fnComplexity('cold', 20, 0, 100)]), idx, file);
    expect(score).toBeGreaterThanOrEqual(95);
  });

  it('medium-CC very-hot function → high weighted CC → low score', () => {
    // CC=10, hits=10000 → log10(10001) ≈ 4.0 → adjusted ≈ 40 → normCyc=100 →
    // contribution from CC = 0. Combined with cognitive=20 (normCog ≈ 40,
    // contribution = 60 * 0.3 = 18) and MI=50 (contribution = 50*0.4=20), the
    // total is much lower than the dead-code case.
    const file = '/proj/hot.ts';
    const idx = buildCoverageIndex([script(file, [covFn('hot', 10000)])]);
    const score = computeWeightedFileScore(fc([fnComplexity('hot', 10, 20, 50)]), idx, file);
    expect(score).toBeLessThan(50);
  });

  it('low-CC hot function → low weighted CC → high score', () => {
    // CC=2, hits=10000 → log10(10001)≈4 → adjusted≈8 → normCyc≈26.7. Still
    // lots of room. Combined with healthy MI (90) → score in the 80s.
    const file = '/proj/lib.ts';
    const idx = buildCoverageIndex([script(file, [covFn('helper', 10000)])]);
    const score = computeWeightedFileScore(fc([fnComplexity('helper', 2, 0, 90)]), idx, file);
    expect(score).toBeGreaterThanOrEqual(70);
  });

  it('coverage missing for function → treated as hits=0 (zero contribution)', () => {
    // No coverage entry for `lonely` → weight = log10(1) = 0 → adjusted = 0.
    const file = '/proj/uncovered.ts';
    const idx = buildCoverageIndex([script(file, [])]);
    const score = computeWeightedFileScore(fc([fnComplexity('lonely', 30, 0, 100)]), idx, file);
    // sumAdjusted=0, meanCog=0, meanMi=100 → score = 0.3*100 + 0.3*100 + 0.4*100 = 100
    expect(score).toBe(100);
  });

  it('empty FileComplexity → score 100 (no functions to weight)', () => {
    const idx = buildCoverageIndex([]);
    const score = computeWeightedFileScore(fc([]), idx, '/proj/empty.ts');
    expect(score).toBe(100);
  });

  it('determinism: identical inputs produce identical outputs', () => {
    const file = '/proj/d.ts';
    const idx = buildCoverageIndex([script(file, [covFn('a', 5), covFn('b', 100)])]);
    const file_complexity = fc([fnComplexity('a', 4, 2, 80), fnComplexity('b', 8, 5, 70)]);
    const s1 = computeWeightedFileScore(file_complexity, idx, file);
    const s2 = computeWeightedFileScore(file_complexity, idx, file);
    expect(s1).toBe(s2);
  });
});
