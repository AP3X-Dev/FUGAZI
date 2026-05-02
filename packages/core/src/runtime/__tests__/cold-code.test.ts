/**
 * cold-code.test.ts — Phase 3g Wave A acceptance suite for `findColdCode`.
 */

import type { FunctionCoverage, ScriptCoverage } from '@fugazi/v8-coverage';
import { describe, expect, it } from 'vitest';
import { findColdCode } from '../cold-code.js';
import { buildCoverageIndex } from '../coverage-shape.js';

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

describe('findColdCode', () => {
  it('(a) function with 0 hits → flagged cold', () => {
    const idx = buildCoverageIndex([script('/proj/a.ts', [fn('cold', 0), fn('warm', 5)])]);
    const result = findColdCode(idx, new Set(['/proj/a.ts']));
    expect(result.coldCode.length).toBe(1);
    expect(result.coldCode[0]?.functionName).toBe('cold');
    expect(result.coldCode[0]?.hits).toBe(0);
  });

  it('(b) default threshold is 0 — hits=1 NOT flagged', () => {
    const idx = buildCoverageIndex([script('/proj/a.ts', [fn('a', 1)])]);
    expect(findColdCode(idx, new Set(['/proj/a.ts'])).coldCode.length).toBe(0);
  });

  it('(b2) threshold=1 → hits<=1 flagged', () => {
    const idx = buildCoverageIndex([script('/proj/a.ts', [fn('a', 0), fn('b', 1), fn('c', 2)])]);
    const result = findColdCode(idx, new Set(['/proj/a.ts']), { hitThreshold: 1 });
    expect(result.coldCode.length).toBe(2);
    expect(result.coldCode.map((c) => c.functionName)).toEqual(['a', 'b']);
  });

  it('(c) file in modules but no coverage → coverageMissing entry', () => {
    const idx = buildCoverageIndex([script('/proj/a.ts', [fn('a', 5)])]);
    const result = findColdCode(idx, new Set(['/proj/a.ts', '/proj/missing.ts']));
    expect(result.coverageMissing).toEqual(['/proj/missing.ts']);
    expect(result.coldCode).toEqual([]);
  });

  it('(d) suppressed function not flagged', () => {
    const idx = buildCoverageIndex([script('/proj/a.ts', [fn('cold', 0), fn('alsocold', 0)])]);
    const result = findColdCode(idx, new Set(['/proj/a.ts']), {
      suppressedFunctions: new Set(['/proj/a.ts::cold']),
    });
    expect(result.coldCode.length).toBe(1);
    expect(result.coldCode[0]?.functionName).toBe('alsocold');
  });

  it('(e) coverageMissing list sorted lex-asc', () => {
    const idx = buildCoverageIndex([]);
    const result = findColdCode(idx, new Set(['/proj/z.ts', '/proj/a.ts', '/proj/m.ts']));
    expect(result.coverageMissing).toEqual(['/proj/a.ts', '/proj/m.ts', '/proj/z.ts']);
  });

  it('(f) coldCode sorted by (file, functionName) lex-asc', () => {
    const idx = buildCoverageIndex([
      script('/proj/z.ts', [fn('zz', 0), fn('aa', 0)]),
      script('/proj/a.ts', [fn('mm', 0), fn('bb', 0)]),
    ]);
    const result = findColdCode(idx, new Set(['/proj/a.ts', '/proj/z.ts']));
    expect(result.coldCode.map((c) => `${c.file}::${c.functionName}`)).toEqual([
      '/proj/a.ts::bb',
      '/proj/a.ts::mm',
      '/proj/z.ts::aa',
      '/proj/z.ts::zz',
    ]);
  });

  it('(g) determinism: same input → identical output', () => {
    const fns: FunctionCoverage[] = [];
    for (let i = 0; i < 30; i++) fns.push(fn(`f${i}`, i % 3 === 0 ? 0 : i));
    const idx1 = buildCoverageIndex([script('/proj/a.ts', fns)]);
    const idx2 = buildCoverageIndex([script('/proj/a.ts', fns)]);
    const a = findColdCode(idx1, new Set(['/proj/a.ts', '/proj/missing.ts']));
    const b = findColdCode(idx2, new Set(['/proj/a.ts', '/proj/missing.ts']));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('files outside `modules` are ignored even if covered', () => {
    const idx = buildCoverageIndex([
      script('/proj/a.ts', [fn('a', 0)]),
      script('/dep/b.ts', [fn('b', 0)]),
    ]);
    const result = findColdCode(idx, new Set(['/proj/a.ts']));
    expect(result.coldCode.length).toBe(1);
    expect(result.coldCode[0]?.file).toBe('/proj/a.ts');
  });

  it('aggregates hits across multiple ranges (cold only when sum is 0)', () => {
    const fnMulti: FunctionCoverage = {
      functionName: 'sum-positive',
      isBlockCoverage: true,
      ranges: [
        { startOffset: 0, endOffset: 10, count: 0 },
        { startOffset: 10, endOffset: 20, count: 1 },
      ],
    };
    const fnAllZero: FunctionCoverage = {
      functionName: 'sum-zero',
      isBlockCoverage: true,
      ranges: [
        { startOffset: 0, endOffset: 10, count: 0 },
        { startOffset: 10, endOffset: 20, count: 0 },
      ],
    };
    const idx = buildCoverageIndex([script('/proj/a.ts', [fnMulti, fnAllZero])]);
    const result = findColdCode(idx, new Set(['/proj/a.ts']));
    expect(result.coldCode.length).toBe(1);
    expect(result.coldCode[0]?.functionName).toBe('sum-zero');
  });

  it('result and inner arrays are frozen', () => {
    const idx = buildCoverageIndex([script('/proj/a.ts', [fn('a', 0)])]);
    const result = findColdCode(idx, new Set(['/proj/a.ts', '/proj/missing.ts']));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.coldCode)).toBe(true);
    expect(Object.isFrozen(result.coverageMissing)).toBe(true);
  });

  it('empty modules → empty everything', () => {
    const idx = buildCoverageIndex([script('/proj/a.ts', [fn('a', 0)])]);
    const result = findColdCode(idx, new Set());
    expect(result.coldCode).toEqual([]);
    expect(result.coverageMissing).toEqual([]);
  });

  it('line/col are 0 in Wave A (deferred to Wave B)', () => {
    const idx = buildCoverageIndex([script('/proj/a.ts', [fn('a', 0)])]);
    const result = findColdCode(idx, new Set(['/proj/a.ts']));
    expect(result.coldCode[0]?.line).toBe(0);
    expect(result.coldCode[0]?.col).toBe(0);
  });
});
