/**
 * script-id.test.ts — Phase 3e (T113) — URL-disambiguation + merge.
 *
 * Five fixtures: distinct URLs preserved, same-URL merge, missing-URL fallback,
 * Node multi-worker case, merge associativity.
 */

import { describe, expect, it } from 'vitest';
import { disambiguateScripts } from '../script-id.js';
import type { CoverageInput, ScriptCoverage } from '../types.js';

const f = (
  scriptId: string,
  url: string,
  fns: Array<{ name: string; ranges: Array<[number, number, number]>; block?: boolean }> = [],
): ScriptCoverage => ({
  scriptId,
  url,
  functions: fns.map((fn) => ({
    functionName: fn.name,
    ranges: fn.ranges.map(([s, e, c]) => ({ startOffset: s, endOffset: e, count: c })),
    isBlockCoverage: fn.block ?? false,
  })),
});

describe('disambiguateScripts — same scriptId different URLs kept distinct', () => {
  it('does not merge entries that differ only by URL', () => {
    const input: CoverageInput = {
      result: [
        f('1', 'file:///a.js', [{ name: 'a', ranges: [[0, 5, 1]] }]),
        f('1', 'file:///b.js', [{ name: 'b', ranges: [[0, 5, 1]] }]),
      ],
    };
    const out = disambiguateScripts(input);
    expect(out).toHaveLength(2);
    expect(out[0]?.url).toBe('file:///a.js');
    expect(out[1]?.url).toBe('file:///b.js');
  });
});

describe('disambiguateScripts — same URL collapsed and unioned', () => {
  it('unions function arrays and sums overlapping range counts', () => {
    const input: CoverageInput = {
      result: [
        f('1', 'file:///x.js', [{ name: 'foo', ranges: [[0, 10, 2]] }]),
        f('2', 'file:///x.js', [
          { name: 'foo', ranges: [[0, 10, 3]] },
          { name: 'bar', ranges: [[10, 20, 5]] },
        ]),
      ],
    };
    const out = disambiguateScripts(input);
    expect(out).toHaveLength(1);
    const merged = out[0];
    expect(merged?.url).toBe('file:///x.js');
    expect(merged?.functions).toHaveLength(2);
    const foo = merged?.functions.find((fn) => fn.functionName === 'foo');
    expect(foo?.ranges[0]?.count).toBe(5);
    const bar = merged?.functions.find((fn) => fn.functionName === 'bar');
    expect(bar?.ranges[0]?.count).toBe(5);
  });
});

describe('disambiguateScripts — missing URL falls back to script:<id>', () => {
  it('keeps missing-URL entries distinct by scriptId', () => {
    const input: CoverageInput = {
      result: [
        f('7', '', [{ name: 'a', ranges: [[0, 5, 1]] }]),
        f('8', '', [{ name: 'b', ranges: [[0, 5, 1]] }]),
      ],
    };
    const out = disambiguateScripts(input);
    expect(out).toHaveLength(2);
    expect(out[0]?.scriptId).toBe('7');
    expect(out[1]?.scriptId).toBe('8');
  });
});

describe('disambiguateScripts — Node multi-worker case', () => {
  it('preserves four scripts across two workers with overlapping IDs', () => {
    const input: CoverageInput = {
      result: [
        // Worker 1
        f('1', 'file:///module-a.js', [{ name: 'fa', ranges: [[0, 10, 1]] }]),
        f('2', 'file:///module-b.js', [{ name: 'fb', ranges: [[0, 10, 1]] }]),
        // Worker 2 — same scriptIds, different files
        f('1', 'file:///module-c.js', [{ name: 'fc', ranges: [[0, 10, 1]] }]),
        f('2', 'file:///module-d.js', [{ name: 'fd', ranges: [[0, 10, 1]] }]),
      ],
    };
    const out = disambiguateScripts(input);
    expect(out).toHaveLength(4);
    expect(out.map((s) => s.url)).toEqual([
      'file:///module-a.js',
      'file:///module-b.js',
      'file:///module-c.js',
      'file:///module-d.js',
    ]);
  });

  it('merges duplicates from same worker pair on same URL', () => {
    const input: CoverageInput = {
      result: [
        f('1', 'file:///shared.js', [{ name: 'fa', ranges: [[0, 10, 1]] }]),
        f('99', 'file:///shared.js', [{ name: 'fa', ranges: [[0, 10, 4]] }]),
      ],
    };
    const out = disambiguateScripts(input);
    expect(out).toHaveLength(1);
    expect(out[0]?.functions[0]?.ranges[0]?.count).toBe(5);
  });
});

describe('disambiguateScripts — merge associativity bonus', () => {
  it('merge(a, b) merged with c == merge(a, merge(b, c))', () => {
    const a = f('1', 'file:///s.js', [{ name: 'g', ranges: [[0, 5, 1]] }]);
    const b = f('2', 'file:///s.js', [{ name: 'g', ranges: [[0, 5, 2]] }]);
    const c = f('3', 'file:///s.js', [{ name: 'g', ranges: [[0, 5, 3]] }]);
    const left = disambiguateScripts({ result: [...disambiguateScripts({ result: [a, b] }), c] });
    const right = disambiguateScripts({ result: [a, ...disambiguateScripts({ result: [b, c] })] });
    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
    expect(left[0]?.functions[0]?.ranges[0]?.count).toBe(6);
  });
});
