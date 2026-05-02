/**
 * hot-path.test.ts — Phase 3g Wave A acceptance suite for `findHotPaths`.
 */

import type { FunctionCoverage, ScriptCoverage } from '@fugazi/v8-coverage';
import { describe, expect, it } from 'vitest';
import { buildCoverageIndex } from '../coverage-shape.js';
import { findHotPaths } from '../hot-path.js';

function fn(name: string, count: number): FunctionCoverage {
  return {
    functionName: name,
    isBlockCoverage: false,
    ranges: [{ startOffset: 0, endOffset: 10, count }],
  };
}

function script(url: string, fns: readonly FunctionCoverage[]): ScriptCoverage {
  return { scriptId: '1', url, functions: fns };
}

describe('findHotPaths', () => {
  it('(a) 100 functions hits 1..100, threshold 10 → exactly 10 returned', () => {
    const fns: FunctionCoverage[] = [];
    for (let i = 1; i <= 100; i++) fns.push(fn(`f${String(i).padStart(3, '0')}`, i));
    const idx = buildCoverageIndex([script('/proj/a.ts', fns)]);
    const hot = findHotPaths(idx, { percentileThreshold: 10 });
    expect(hot.length).toBe(10);
    // hottest first: hits 100, 99, …, 91
    expect(hot[0]?.hits).toBe(100);
    expect(hot[9]?.hits).toBe(91);
  });

  it('(b) all functions equal hits → 0 hot paths (uniform distribution)', () => {
    const idx = buildCoverageIndex([script('/proj/a.ts', [fn('a', 5), fn('b', 5), fn('c', 5)])]);
    expect(findHotPaths(idx, { percentileThreshold: 10 })).toEqual([]);
  });

  it('(c) 1 dominant function → exactly that function flagged', () => {
    const fns: FunctionCoverage[] = [fn('hot', 1000)];
    for (let i = 0; i < 99; i++) fns.push(fn(`cold${String(i).padStart(2, '0')}`, 1));
    const idx = buildCoverageIndex([script('/proj/a.ts', fns)]);
    const hot = findHotPaths(idx, { percentileThreshold: 1 });
    expect(hot.length).toBe(1);
    expect(hot[0]?.functionName).toBe('hot');
    expect(hot[0]?.hits).toBe(1000);
  });

  it('(d) configurable threshold: 5/10/20 returns 5/10/20 functions', () => {
    const fns: FunctionCoverage[] = [];
    for (let i = 1; i <= 100; i++) fns.push(fn(`f${String(i).padStart(3, '0')}`, i));
    const idx = buildCoverageIndex([script('/proj/a.ts', fns)]);
    expect(findHotPaths(idx, { percentileThreshold: 5 }).length).toBe(5);
    expect(findHotPaths(idx, { percentileThreshold: 10 }).length).toBe(10);
    expect(findHotPaths(idx, { percentileThreshold: 20 }).length).toBe(20);
  });

  it('(e) tie-breaking: same hits → lex-asc by (file, functionName)', () => {
    const idx = buildCoverageIndex([
      script('/proj/b.ts', [fn('zzz', 50)]),
      script('/proj/a.ts', [fn('aaa', 50), fn('bbb', 50)]),
      // throw in a clearly-hotter function so uniform-collapse short-circuit
      // doesn't kick in
      script('/proj/c.ts', [fn('top', 100)]),
    ]);
    const hot = findHotPaths(idx, { percentileThreshold: 100 });
    // top first, then ties at 50 sorted by (file, name)
    expect(hot.map((h) => `${h.file}::${h.functionName}`)).toEqual([
      '/proj/c.ts::top',
      '/proj/a.ts::aaa',
      '/proj/a.ts::bbb',
      '/proj/b.ts::zzz',
    ]);
  });

  it('(f) determinism: same input → identical output across runs', () => {
    const fns: FunctionCoverage[] = [];
    for (let i = 1; i <= 50; i++) fns.push(fn(`f${i}`, ((i * 7) % 13) + 1));
    const idx1 = buildCoverageIndex([script('/proj/a.ts', fns)]);
    const idx2 = buildCoverageIndex([script('/proj/a.ts', fns)]);
    const a = findHotPaths(idx1, { percentileThreshold: 10 });
    const b = findHotPaths(idx2, { percentileThreshold: 10 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('(g) hits === 0 functions excluded (those are cold, not hot)', () => {
    const idx = buildCoverageIndex([
      script('/proj/a.ts', [fn('a', 0), fn('b', 0), fn('c', 100), fn('d', 50)]),
    ]);
    const hot = findHotPaths(idx, { percentileThreshold: 100 });
    expect(hot.length).toBe(2);
    expect(hot.map((h) => h.functionName)).toEqual(['c', 'd']);
  });

  it('percentile is (rank / total) * 100, rank=0 is hottest', () => {
    const fns: FunctionCoverage[] = [];
    for (let i = 1; i <= 10; i++) fns.push(fn(`f${i}`, i));
    const idx = buildCoverageIndex([script('/proj/a.ts', fns)]);
    const hot = findHotPaths(idx, { percentileThreshold: 100 });
    expect(hot.length).toBe(10);
    expect(hot[0]?.percentile).toBe(0);
    expect(hot[9]?.percentile).toBe(90);
  });

  it('aggregates hits across multiple ranges', () => {
    const fnMulti: FunctionCoverage = {
      functionName: 'multi',
      isBlockCoverage: true,
      ranges: [
        { startOffset: 0, endOffset: 10, count: 2 },
        { startOffset: 10, endOffset: 20, count: 3 },
        { startOffset: 20, endOffset: 30, count: 5 },
      ],
    };
    const idx = buildCoverageIndex([script('/proj/a.ts', [fnMulti, fn('other', 1)])]);
    const hot = findHotPaths(idx, { percentileThreshold: 50 });
    expect(hot[0]?.functionName).toBe('multi');
    expect(hot[0]?.hits).toBe(10);
  });

  it('empty coverage → empty result', () => {
    const idx = buildCoverageIndex([]);
    expect(findHotPaths(idx)).toEqual([]);
  });

  it('all hits zero → empty result (no hot paths from cold input)', () => {
    const idx = buildCoverageIndex([script('/proj/a.ts', [fn('a', 0), fn('b', 0)])]);
    expect(findHotPaths(idx)).toEqual([]);
  });

  it('default threshold is 10', () => {
    const fns: FunctionCoverage[] = [];
    for (let i = 1; i <= 100; i++) fns.push(fn(`f${String(i).padStart(3, '0')}`, i));
    const idx = buildCoverageIndex([script('/proj/a.ts', fns)]);
    expect(findHotPaths(idx).length).toBe(10);
  });

  it('line/col are 0 in Wave A (deferred to Wave B)', () => {
    const idx = buildCoverageIndex([script('/proj/a.ts', [fn('a', 1), fn('b', 100)])]);
    const hot = findHotPaths(idx, { percentileThreshold: 100 });
    for (const f of hot) {
      expect(f.line).toBe(0);
      expect(f.col).toBe(0);
    }
  });
});
