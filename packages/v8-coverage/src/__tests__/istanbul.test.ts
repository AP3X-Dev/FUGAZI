/**
 * istanbul.test.ts — Phase 3e (T117) — V8 → Istanbul normalization.
 *
 * Six fixtures: single block-covered function, multiple functions, empty input,
 * non-block coverage path, determinism, hit-count preservation.
 */

import { describe, expect, it } from 'vitest';
import { normalizeToIstanbul } from '../istanbul.js';
import type { ScriptCoverage } from '../types.js';

describe('normalizeToIstanbul — single function with block coverage', () => {
  it('emits both fnMap and branchMap entries', () => {
    const source = 'function alpha() {\n  if (x) y;\n}\n';
    const script: ScriptCoverage = {
      scriptId: '1',
      url: 'file:///t/a.js',
      functions: [
        {
          functionName: 'alpha',
          ranges: [
            { startOffset: 0, endOffset: source.length, count: 5 },
            // Inner block range
            { startOffset: 21, endOffset: 28, count: 2 },
          ],
          isBlockCoverage: true,
        },
      ],
    };
    const out = normalizeToIstanbul(script, source);
    expect(out.fnMap['0']?.name).toBe('alpha');
    expect(out.f['0']).toBe(5);
    expect(out.branchMap['0']?.type).toBe('branch');
    expect(out.b['0']).toEqual([2]);
    expect(out.s['0']).toBe(2);
  });
});

describe('normalizeToIstanbul — multiple functions', () => {
  it('emits keys 0,1,... in declaration order', () => {
    const source = 'function a() {}\nfunction b() {}\n';
    const script: ScriptCoverage = {
      scriptId: '1',
      url: 'file:///t/m.js',
      functions: [
        {
          functionName: 'a',
          ranges: [{ startOffset: 0, endOffset: 15, count: 3 }],
          isBlockCoverage: false,
        },
        {
          functionName: 'b',
          ranges: [{ startOffset: 16, endOffset: 31, count: 0 }],
          isBlockCoverage: false,
        },
      ],
    };
    const out = normalizeToIstanbul(script, source);
    expect(Object.keys(out.fnMap)).toEqual(['0', '1']);
    expect(out.fnMap['0']?.name).toBe('a');
    expect(out.fnMap['1']?.name).toBe('b');
    expect(out.f['0']).toBe(3);
    expect(out.f['1']).toBe(0);
    expect(out.fnMap['1']?.line).toBe(2);
  });
});

describe('normalizeToIstanbul — empty script.functions', () => {
  it('returns a valid empty Istanbul object', () => {
    const out = normalizeToIstanbul({ scriptId: '1', url: 'file:///t/e.js', functions: [] }, '');
    expect(out.path).toBe('file:///t/e.js');
    expect(out.fnMap).toEqual({});
    expect(out.f).toEqual({});
    expect(out.statementMap).toEqual({});
    expect(out.s).toEqual({});
    expect(out.branchMap).toEqual({});
    expect(out.b).toEqual({});
  });
});

describe('normalizeToIstanbul — isBlockCoverage:false leaves branchMap empty', () => {
  it('only fnMap/f populated; branchMap empty', () => {
    const source = 'function only() {}\n';
    const script: ScriptCoverage = {
      scriptId: '1',
      url: 'file:///t/n.js',
      functions: [
        {
          functionName: 'only',
          ranges: [{ startOffset: 0, endOffset: 18, count: 7 }],
          isBlockCoverage: false,
        },
      ],
    };
    const out = normalizeToIstanbul(script, source);
    expect(Object.keys(out.fnMap)).toEqual(['0']);
    expect(out.f['0']).toBe(7);
    expect(out.branchMap).toEqual({});
    expect(out.b).toEqual({});
    // Statement entry IS still emitted so callers can compute statement coverage.
    expect(out.s['0']).toBe(7);
  });
});

describe('normalizeToIstanbul — determinism', () => {
  it('produces byte-equal JSON for the same input run twice', () => {
    const source = 'function a() {}\nfunction b() { if (x) y; }\n';
    const script: ScriptCoverage = {
      scriptId: '1',
      url: 'file:///t/d.js',
      functions: [
        {
          functionName: 'a',
          ranges: [{ startOffset: 0, endOffset: 15, count: 1 }],
          isBlockCoverage: false,
        },
        {
          functionName: 'b',
          ranges: [
            { startOffset: 16, endOffset: 42, count: 1 },
            { startOffset: 32, endOffset: 39, count: 0 },
          ],
          isBlockCoverage: true,
        },
      ],
    };
    const a = JSON.stringify(normalizeToIstanbul(script, source));
    const b = JSON.stringify(normalizeToIstanbul(script, source));
    expect(a).toBe(b);
  });
});

describe('normalizeToIstanbul — hit counts preserved exactly', () => {
  it('does not transform numeric counts', () => {
    const source = 'function k() {}\n';
    const script: ScriptCoverage = {
      scriptId: '1',
      url: 'file:///t/h.js',
      functions: [
        {
          functionName: 'k',
          ranges: [{ startOffset: 0, endOffset: 15, count: 9999999 }],
          isBlockCoverage: false,
        },
      ],
    };
    const out = normalizeToIstanbul(script, source);
    expect(out.f['0']).toBe(9999999);
  });

  it('renames empty functionName to (anonymous)', () => {
    const source = '() => {}';
    const script: ScriptCoverage = {
      scriptId: '1',
      url: 'file:///t/anon.js',
      functions: [
        {
          functionName: '',
          ranges: [{ startOffset: 0, endOffset: 8, count: 1 }],
          isBlockCoverage: false,
        },
      ],
    };
    const out = normalizeToIstanbul(script, source);
    expect(out.fnMap['0']?.name).toBe('(anonymous)');
  });
});
