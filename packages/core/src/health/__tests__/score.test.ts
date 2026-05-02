/**
 * health/__tests__/score.test.ts — Phase 3f.5 (T164).
 *
 * Pure-data tests over fabricated `FileComplexity` literals. We don't parse
 * real source — the complexity API is exercised in `@fugazi/extract`. Here
 * we only verify the score formula, project-mean reduction, refactor-target
 * ordering, formatScoreLine output, and edge-case clamping.
 */

import type { FileComplexity } from '@fugazi/extract';
import { describe, expect, it } from 'vitest';
import {
  computeFileScore,
  computeProjectScore,
  computeRefactorTargets,
  formatScoreLine,
} from '../score.js';
import type { HealthScore } from '../types.js';

function fc(cyc: number, cog: number, mi: number): FileComplexity {
  return Object.freeze({
    functions: Object.freeze([]),
    aggregate: Object.freeze({
      cyclomatic: cyc,
      cognitive: cog,
      maintainabilityIndex: mi,
      loc: 0,
    }),
  });
}

function hs(file: string, score: number): HealthScore {
  return Object.freeze({
    file,
    score,
    cyclomatic: 0,
    cognitive: 0,
    maintainabilityIndex: 100,
  });
}

describe('computeFileScore', () => {
  it('(a) trivial file (cyc=1, cog=0, MI≈100) scores ~99-100', () => {
    const score = computeFileScore(fc(1, 0, 100));
    // 0.3*(100 - 3.33) + 0.3*100 + 0.4*100 = 99.0
    expect(score).toBeGreaterThanOrEqual(98);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('(b) high-complexity file (cyc=30, cog=50, MI=20) is much lower', () => {
    const score = computeFileScore(fc(30, 50, 20));
    // 0.3*0 + 0.3*0 + 0.4*20 = 8
    expect(score).toBe(8);
  });

  it('respects custom weights', () => {
    const score = computeFileScore(fc(0, 0, 50), {
      cyclomatic: 0,
      cognitive: 0,
      mi: 1,
    });
    expect(score).toBe(50);
  });

  it('(g) edge case: zeros everywhere yields finite (no NaN)', () => {
    const score = computeFileScore(fc(0, 0, 0));
    // 0.3*100 + 0.3*100 + 0.4*0 = 60
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBe(60);
  });

  it('clamps NaN/Infinity inputs to 100', () => {
    const broken: FileComplexity = Object.freeze({
      functions: Object.freeze([]),
      aggregate: Object.freeze({
        cyclomatic: 0,
        cognitive: 0,
        maintainabilityIndex: Number.NaN,
        loc: 0,
      }),
    });
    expect(computeFileScore(broken)).toBe(100);
  });

  it('clamps over-threshold cyclomatic/cognitive to 0 contribution', () => {
    // cyc=300 is 10x the norm; should clamp.
    const score = computeFileScore(fc(300, 500, 0));
    // 0.3*0 + 0.3*0 + 0.4*0 = 0
    expect(score).toBe(0);
  });

  it('(h) determinism: identical input yields identical output', () => {
    const a = computeFileScore(fc(7, 11, 73));
    const b = computeFileScore(fc(7, 11, 73));
    expect(a).toBe(b);
  });
});

describe('computeProjectScore', () => {
  it('(c) mean of three file scores, rounded', () => {
    const map = new Map<string, HealthScore>([
      ['/a.ts', hs('/a.ts', 80)],
      ['/b.ts', hs('/b.ts', 60)],
      ['/c.ts', hs('/c.ts', 70)],
    ]);
    expect(computeProjectScore(map)).toBe(70);
  });

  it('empty map yields 100', () => {
    expect(computeProjectScore(new Map())).toBe(100);
  });

  it('rounds to nearest integer', () => {
    const map = new Map<string, HealthScore>([
      ['/a.ts', hs('/a.ts', 50)],
      ['/b.ts', hs('/b.ts', 51)],
      ['/c.ts', hs('/c.ts', 50)],
    ]);
    // mean = 50.333… → 50
    expect(computeProjectScore(map)).toBe(50);
  });
});

describe('computeRefactorTargets', () => {
  it('(d) returns top K by ascending score', () => {
    const map = new Map<string, HealthScore>([
      ['/a.ts', hs('/a.ts', 90)],
      ['/b.ts', hs('/b.ts', 30)],
      ['/c.ts', hs('/c.ts', 70)],
      ['/d.ts', hs('/d.ts', 20)],
      ['/e.ts', hs('/e.ts', 50)],
      ['/f.ts', hs('/f.ts', 10)],
    ]);
    const out = computeRefactorTargets(map, 3);
    expect(out.map((t) => t.file)).toEqual(['/f.ts', '/d.ts', '/b.ts']);
    expect(out.map((t) => t.score)).toEqual([10, 20, 30]);
  });

  it('(e) ties broken by lex-asc file path', () => {
    const map = new Map<string, HealthScore>([
      ['/zeta.ts', hs('/zeta.ts', 50)],
      ['/alpha.ts', hs('/alpha.ts', 50)],
      ['/mid.ts', hs('/mid.ts', 50)],
    ]);
    const out = computeRefactorTargets(map, 5);
    expect(out.map((t) => t.file)).toEqual(['/alpha.ts', '/mid.ts', '/zeta.ts']);
  });

  it('default k=10', () => {
    const map = new Map<string, HealthScore>();
    for (let i = 0; i < 15; i++) {
      const path = `/f${i}.ts`;
      map.set(path, hs(path, 100 - i));
    }
    expect(computeRefactorTargets(map).length).toBe(10);
  });

  it('returns empty when k <= 0', () => {
    const map = new Map<string, HealthScore>([['/a.ts', hs('/a.ts', 50)]]);
    expect(computeRefactorTargets(map, 0)).toEqual([]);
  });
});

describe('formatScoreLine', () => {
  it('(f) emits exactly "<N>\\n"', () => {
    expect(formatScoreLine(73)).toBe('73\n');
    expect(formatScoreLine(0)).toBe('0\n');
    expect(formatScoreLine(100)).toBe('100\n');
  });
});
