/**
 * run-runtime.test.ts — Phase 3g Wave B end-to-end acceptance suite for
 * `runRuntime`. Tests use in-memory CoverageInput + complexity fixtures.
 */

import type { FileComplexity, FunctionComplexity } from '@fugazi/extract';
import type { CoverageInput, FunctionCoverage } from '@fugazi/v8-coverage';
import { describe, expect, it } from 'vitest';
import { runRuntime } from '../run-runtime.js';

function fnC(name: string, cyc: number): FunctionComplexity {
  return {
    name,
    cyclomatic: cyc,
    cognitive: 0,
    maintainabilityIndex: 90,
    loc: 10,
    range: { start: { line: 1, col: 0, byteOffset: 0 }, end: { line: 1, col: 0, byteOffset: 1 } },
  };
}

function fc(fns: readonly FunctionComplexity[]): FileComplexity {
  let cyc = 0;
  for (const f of fns) cyc += f.cyclomatic;
  return {
    functions: fns,
    aggregate: {
      cyclomatic: cyc,
      cognitive: 0,
      maintainabilityIndex: fns.length === 0 ? 100 : 90,
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

describe('runRuntime — end-to-end', () => {
  it('5-file project + coverage → all four RuntimeReport fields populated', () => {
    const modules = new Set(['/proj/a.ts', '/proj/b.ts', '/proj/c.ts', '/proj/d.ts', '/proj/e.ts']);
    const coverage: CoverageInput = {
      result: [
        // a: very hot
        { scriptId: '1', url: '/proj/a.ts', functions: [covFn('hotA', 1000)] },
        // b: warm
        { scriptId: '2', url: '/proj/b.ts', functions: [covFn('warmB', 50)] },
        // c: cold (zero hits)
        { scriptId: '3', url: '/proj/c.ts', functions: [covFn('coldC', 0)] },
        // d: medium
        { scriptId: '4', url: '/proj/d.ts', functions: [covFn('midD', 5)] },
        // e: NO coverage entry → coverageMissing
      ],
    };
    const complexityByPath = new Map<string, FileComplexity>([
      ['/proj/a.ts', fc([fnC('hotA', 5)])],
      ['/proj/b.ts', fc([fnC('warmB', 10)])],
      ['/proj/c.ts', fc([fnC('coldC', 30)])],
      ['/proj/d.ts', fc([fnC('midD', 4)])],
      ['/proj/e.ts', fc([fnC('eFn', 2)])],
    ]);
    const report = runRuntime({
      coverage,
      modules,
      complexityByPath,
      projectRoot: '/proj',
    });
    expect(report.schemaVersion).toBe(1);
    expect(report.hotPaths.length).toBeGreaterThan(0);
    expect(report.hotPaths[0]?.functionName).toBe('hotA');
    expect(report.coldCode.length).toBeGreaterThan(0);
    expect(report.coverageMissing).toContain('/proj/e.ts');
    expect(report.weightedRefactorTargets.length).toBeGreaterThan(0);
  });

  it('determinism: two consecutive runs produce identical JSON', () => {
    const modules = new Set(['/proj/a.ts', '/proj/b.ts']);
    const coverage: CoverageInput = {
      result: [
        { scriptId: '1', url: '/proj/a.ts', functions: [covFn('a', 100), covFn('b', 1)] },
        { scriptId: '2', url: '/proj/b.ts', functions: [covFn('c', 0)] },
      ],
    };
    const complexityByPath = new Map<string, FileComplexity>([
      ['/proj/a.ts', fc([fnC('a', 5), fnC('b', 3)])],
      ['/proj/b.ts', fc([fnC('c', 8)])],
    ]);
    const r1 = runRuntime({ coverage, modules, complexityByPath, projectRoot: '/proj' });
    const r2 = runRuntime({ coverage, modules, complexityByPath, projectRoot: '/proj' });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('coverage entirely missing → all modules in coverageMissing', () => {
    const modules = new Set(['/proj/x.ts', '/proj/y.ts']);
    const coverage: CoverageInput = { result: [] };
    const complexityByPath = new Map<string, FileComplexity>([
      ['/proj/x.ts', fc([fnC('xf', 4)])],
      ['/proj/y.ts', fc([fnC('yf', 6)])],
    ]);
    const report = runRuntime({ coverage, modules, complexityByPath, projectRoot: '/proj' });
    expect([...report.coverageMissing].sort()).toEqual(['/proj/x.ts', '/proj/y.ts']);
    expect(report.hotPaths).toEqual([]);
  });

  it('returned report is frozen', () => {
    const report = runRuntime({
      coverage: { result: [] },
      modules: new Set(),
      complexityByPath: new Map(),
      projectRoot: '/proj',
    });
    expect(Object.isFrozen(report)).toBe(true);
  });

  it('explicit coverageRoot rebases inputs before indexing', () => {
    const modules = new Set(['/Users/me/proj/a.ts']);
    const coverage: CoverageInput = {
      result: [{ scriptId: '1', url: '/runner/a.ts', functions: [covFn('foo', 100)] }],
    };
    const complexityByPath = new Map<string, FileComplexity>([
      ['/Users/me/proj/a.ts', fc([fnC('foo', 5)])],
    ]);
    const report = runRuntime({
      coverage,
      modules,
      complexityByPath,
      projectRoot: '/Users/me/proj',
      coverageRoot: { from: '/runner/', to: '/Users/me/proj/' },
    });
    // After rebase, the coverage URL aligns with the project module → no
    // entry in coverageMissing for `/Users/me/proj/a.ts`.
    expect(report.coverageMissing).not.toContain('/Users/me/proj/a.ts');
  });
});
