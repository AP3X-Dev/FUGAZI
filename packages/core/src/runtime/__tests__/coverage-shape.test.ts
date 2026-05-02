/**
 * coverage-shape.test.ts — Phase 3g Wave A acceptance suite for
 * `buildCoverageIndex`. In-memory ScriptCoverage fixtures only.
 */

import type { FunctionCoverage, ScriptCoverage } from '@fugazi/v8-coverage';
import { describe, expect, it } from 'vitest';
import { buildCoverageIndex } from '../coverage-shape.js';

function fn(name: string, count = 1): FunctionCoverage {
  return {
    functionName: name,
    isBlockCoverage: false,
    ranges: [{ startOffset: 0, endOffset: 10, count }],
  };
}

function script(url: string, fns: readonly FunctionCoverage[]): ScriptCoverage {
  return { scriptId: '1', url, functions: fns };
}

describe('buildCoverageIndex', () => {
  it('(a) single script with 3 functions → byFile has 1 entry, byFunction has 3', () => {
    const idx = buildCoverageIndex([script('/proj/a.ts', [fn('foo'), fn('bar'), fn('baz')])]);
    expect(idx.byFile.size).toBe(1);
    expect(idx.byFile.get('/proj/a.ts')?.length).toBe(3);
    expect(idx.byFunction.size).toBe(3);
    expect(idx.byFunction.get('/proj/a.ts::foo')?.functionName).toBe('foo');
    expect(idx.byFunction.get('/proj/a.ts::bar')?.functionName).toBe('bar');
    expect(idx.byFunction.get('/proj/a.ts::baz')?.functionName).toBe('baz');
  });

  it('(b) multiple scripts → properly partitioned', () => {
    const idx = buildCoverageIndex([
      script('/proj/a.ts', [fn('foo')]),
      script('/proj/b.ts', [fn('foo'), fn('bar')]),
    ]);
    expect(idx.byFile.size).toBe(2);
    expect(idx.byFile.get('/proj/a.ts')?.length).toBe(1);
    expect(idx.byFile.get('/proj/b.ts')?.length).toBe(2);
    expect(idx.byFunction.get('/proj/a.ts::foo')).toBeDefined();
    expect(idx.byFunction.get('/proj/b.ts::foo')).toBeDefined();
    expect(idx.byFunction.get('/proj/b.ts::bar')).toBeDefined();
  });

  it('(c) anonymous-function name collision → byFunction keys disambiguated', () => {
    const f1 = fn('<anonymous>', 1);
    const f2 = fn('<anonymous>', 2);
    const f3 = fn('<anonymous>', 3);
    const idx = buildCoverageIndex([script('/proj/a.ts', [f1, f2, f3])]);
    expect(idx.byFile.get('/proj/a.ts')?.length).toBe(3);
    expect(idx.byFunction.size).toBe(3);
    expect(idx.byFunction.get('/proj/a.ts::<anonymous>')).toBe(f1);
    expect(idx.byFunction.get('/proj/a.ts::<anonymous>::1')).toBe(f2);
    expect(idx.byFunction.get('/proj/a.ts::<anonymous>::2')).toBe(f3);
  });

  it('(c2) empty-string functionName collisions also disambiguated', () => {
    const idx = buildCoverageIndex([script('/proj/a.ts', [fn(''), fn('')])]);
    expect(idx.byFunction.size).toBe(2);
    expect(idx.byFunction.has('/proj/a.ts::')).toBe(true);
    expect(idx.byFunction.has('/proj/a.ts::::1')).toBe(true);
  });

  it('(d1) URL form: `file:///C:/foo.ts` → `C:/foo.ts`', () => {
    const idx = buildCoverageIndex([script('file:///C:/foo.ts', [fn('a')])]);
    expect([...idx.byFile.keys()]).toEqual(['C:/foo.ts']);
  });

  it('(d2) URL form: `file:///foo/bar.ts` → `/foo/bar.ts`', () => {
    const idx = buildCoverageIndex([script('file:///foo/bar.ts', [fn('a')])]);
    expect([...idx.byFile.keys()]).toEqual(['/foo/bar.ts']);
  });

  it('(d3) URL form: relative `foo.ts` → `foo.ts`', () => {
    const idx = buildCoverageIndex([script('foo.ts', [fn('a')])]);
    expect([...idx.byFile.keys()]).toEqual(['foo.ts']);
  });

  it('(d4) backslashes converted to forward slashes', () => {
    const idx = buildCoverageIndex([script('C:\\proj\\a.ts', [fn('a')])]);
    expect([...idx.byFile.keys()]).toEqual(['C:/proj/a.ts']);
  });

  it('(d5) `file:///C:\\proj\\a.ts` → `C:/proj/a.ts`', () => {
    const idx = buildCoverageIndex([script('file:///C:\\proj\\a.ts', [fn('a')])]);
    expect([...idx.byFile.keys()]).toEqual(['C:/proj/a.ts']);
  });

  it('returned index is frozen and inner arrays are frozen', () => {
    const idx = buildCoverageIndex([script('/proj/a.ts', [fn('foo')])]);
    expect(Object.isFrozen(idx)).toBe(true);
    const bucket = idx.byFile.get('/proj/a.ts');
    expect(bucket).toBeDefined();
    if (bucket !== undefined) expect(Object.isFrozen(bucket)).toBe(true);
  });

  it('insertion order preserved across maps for determinism', () => {
    const idx = buildCoverageIndex([
      script('/z.ts', [fn('z1'), fn('z2')]),
      script('/a.ts', [fn('a1')]),
    ]);
    expect([...idx.byFile.keys()]).toEqual(['/z.ts', '/a.ts']);
    expect([...idx.byFunction.keys()]).toEqual(['/z.ts::z1', '/z.ts::z2', '/a.ts::a1']);
  });

  it('empty input → empty index', () => {
    const idx = buildCoverageIndex([]);
    expect(idx.byFile.size).toBe(0);
    expect(idx.byFunction.size).toBe(0);
  });
});
