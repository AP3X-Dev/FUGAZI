/**
 * parser-oxc.test.ts — T049-test / T050 acceptance suite for the WASM parser
 * adapter (Wave 5b-2).
 *
 * Covers:
 *   - WASM integrity contract (verbatim error messages, fail-hard on tamper).
 *   - Fail-soft syntax-error contract (errors[] populated, no throw).
 *   - Discriminated-union AST shape across 12+ language fixtures (TS, TSX,
 *     JS, JSX, decorators, optional chaining, nullish coalescing, top-level
 *     await, import attributes, satisfies, const-type-parameters, dynamic
 *     import, re-export, enum, namespace, class field).
 *   - UTF-8 multi-byte byte-offset correctness.
 *   - Determinism across two consecutive runs.
 *   - BOM tolerance.
 *   - Empty source fast path.
 *
 * Total: 6 contract cases + 12+ language fixtures >= 18 fixtures (T049-test
 * acceptance criterion).
 */

import { FugaziParseError } from '@fugazi/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from '../parsers/oxc.js';
import { type Manifest, __setManifestForTest } from '../wasm/integrity.js';
import { __clearWasmCacheForTest } from '../wasm/load.js';

// The on-disk manifest entry the adapter expects to find. Tests that inject a
// synthetic manifest reuse these values to keep "known-good" state in sync.
const REAL_MANIFEST: Manifest = {
  blobs: {
    swc: {
      path: 'node_modules/@swc/wasm/wasm_bg.wasm',
      sha256: 'a400243367e0731a958f97e4cafd76b7282bd361c6a13e65d1d177d32ee125ec',
    },
  },
};

beforeEach(() => {
  // Restore the canonical manifest + drop the compiled-module cache so each
  // test sees a fresh integrity verification path.
  __setManifestForTest(REAL_MANIFEST);
  __clearWasmCacheForTest();
});

afterEach(() => {
  __setManifestForTest(null);
  __clearWasmCacheForTest();
});

describe('parser-oxc adapter — contract', () => {
  it('parse(empty) returns an empty Program with no errors', async () => {
    const r = await parse('', { filename: 'a.ts', lang: 'ts' });
    expect(r.errors).toEqual([]);
    expect(r.program).not.toBeNull();
    if (r.program === null) return;
    expect(r.program.kind).toBe('Program');
    expect(r.program.body).toEqual([]);
    expect(r.program.filename).toBe('a.ts');
    expect(r.program.language).toBe('ts');
  });

  it('parse is deterministic — two consecutive runs yield byte-identical JSON', async () => {
    // 100-line TS fixture covering imports, exports, classes, types.
    const lines: string[] = [];
    for (let i = 0; i < 25; i++) {
      lines.push(`import { thing${i} } from './m${i}';`);
      lines.push(`export const v${i}: number = ${i};`);
      lines.push(`class C${i} { x = ${i}; }`);
      lines.push(`function f${i}(a: number): number { return a + ${i}; }`);
    }
    const src = lines.join('\n');
    const r1 = await parse(src, { filename: 'big.ts', lang: 'ts' });
    const r2 = await parse(src, { filename: 'big.ts', lang: 'ts' });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('tampered WASM throws FugaziParseError(WASM_INTEGRITY) with verbatim message', async () => {
    // Pin a wrong sha so the streaming hash check fails. Path stays valid so
    // the verifier reaches the hash comparison rather than the missing-file
    // branch.
    const wrongHash = '0'.repeat(64);
    __setManifestForTest({
      blobs: { swc: { path: 'node_modules/@swc/wasm/wasm_bg.wasm', sha256: wrongHash } },
    });
    __clearWasmCacheForTest();

    let caught: unknown;
    try {
      await parse('const x = 1;', { filename: 'a.ts', lang: 'ts' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziParseError);
    const err = caught as FugaziParseError;
    expect(err.code).toBe('WASM_INTEGRITY');
    // Verbatim message contract — see verifyWasmBlob in @fugazi/types.
    expect(err.message).toMatch(
      /^WASM integrity check failed for .*: expected 0{64}, got [0-9a-f]{64}$/,
    );
  });

  it('missing manifest entry throws FugaziParseError(WASM_MISSING) with verbatim message', async () => {
    __setManifestForTest({ blobs: {} });
    __clearWasmCacheForTest();

    let caught: unknown;
    try {
      await parse('const x = 1;', { filename: 'a.ts', lang: 'ts' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziParseError);
    const err = caught as FugaziParseError;
    expect(err.code).toBe('WASM_MISSING');
    expect(err.message).toBe(`WASM blob 'swc' is not registered in manifest`);
  });

  it('syntax error is fail-soft — populates errors[], does NOT throw', async () => {
    const r = await parse('const x = ;', { filename: 'broken.ts', lang: 'ts' });
    expect(r.program).toBeNull();
    expect(r.errors.length).toBeGreaterThanOrEqual(1);
    const first = r.errors[0];
    if (first === undefined) {
      throw new Error('expected at least one error');
    }
    expect(first.code).toBe('PARSE_SYNTAX_ERROR');
    expect(first.file).toBe('broken.ts');
    expect(first.position.line).toBeGreaterThanOrEqual(1);
    expect(first.message.length).toBeGreaterThan(0);
  });

  it('BOM-prefixed source produces an AST equivalent to the plain source', async () => {
    const plain = await parse('const x = 1;', { filename: 'a.ts', lang: 'ts' });
    const bom = await parse('﻿const x = 1;', { filename: 'a.ts', lang: 'ts' });
    // Both successful, same body shape & ranges (filenames intentionally equal).
    expect(JSON.stringify(plain)).toBe(JSON.stringify(bom));
  });
});

describe('parser-oxc adapter — language fixtures (T050: ≥18 fixtures across language features)', () => {
  it('TS: import declaration is classified', async () => {
    const r = await parse(`import foo from './m';`, { filename: 'a.ts', lang: 'ts' });
    expect(r.errors).toEqual([]);
    const body = r.program?.body ?? [];
    expect(body.length).toBe(1);
    const stmt = body[0];
    if (stmt?.kind !== 'ImportDeclaration') {
      throw new Error(`expected ImportDeclaration, got ${stmt?.kind ?? 'undefined'}`);
    }
    expect(stmt.source).toBe('./m');
  });

  it('TS: export declaration is classified', async () => {
    const r = await parse('export const v = 1;', { filename: 'a.ts', lang: 'ts' });
    expect(r.errors).toEqual([]);
    const body = r.program?.body ?? [];
    expect(body.length).toBe(1);
    const stmt = body[0];
    if (stmt?.kind !== 'ExportDeclaration') {
      throw new Error(`expected ExportDeclaration, got ${stmt?.kind ?? 'undefined'}`);
    }
    expect(stmt.source).toBeNull();
  });

  it('TS: re-export carries source', async () => {
    const r = await parse(`export * from './re';`, { filename: 'a.ts', lang: 'ts' });
    expect(r.errors).toEqual([]);
    const stmt = r.program?.body[0];
    if (stmt?.kind !== 'ExportDeclaration') {
      throw new Error('expected ExportDeclaration');
    }
    expect(stmt.source).toBe('./re');
  });

  it('TSX: JSX is accepted with lang=tsx, rejected with lang=ts', async () => {
    const src = 'const X = <div>hi</div>;';
    const ok = await parse(src, { filename: 'a.tsx', lang: 'tsx' });
    expect(ok.errors).toEqual([]);
    expect(ok.program?.body.length).toBe(1);
    const fail = await parse(src, { filename: 'a.ts', lang: 'ts' });
    expect(fail.program).toBeNull();
    expect(fail.errors.length).toBeGreaterThanOrEqual(1);
  });

  it('JS: plain ECMAScript parses without TypeScript syntax', async () => {
    const r = await parse('const x = 1;', { filename: 'a.js', lang: 'js' });
    expect(r.errors).toEqual([]);
    expect(r.program?.body.length).toBe(1);
  });

  it('JSX: ECMAScript with JSX parses', async () => {
    const r = await parse('const X = <div>hi</div>;', { filename: 'a.jsx', lang: 'jsx' });
    expect(r.errors).toEqual([]);
    expect(r.program?.body.length).toBe(1);
  });

  it('TS: decorator on class declaration', async () => {
    const r = await parse('@dec class A {}', { filename: 'a.ts', lang: 'ts' });
    expect(r.errors).toEqual([]);
    expect(r.program?.body.length).toBe(1);
  });

  it('TS: optional chaining + nullish coalescing', async () => {
    const r = await parse('const a = b?.c ?? d;', { filename: 'a.ts', lang: 'ts' });
    expect(r.errors).toEqual([]);
  });

  it('TS: top-level await', async () => {
    const r = await parse('const x = await foo();', { filename: 'a.ts', lang: 'ts' });
    expect(r.errors).toEqual([]);
  });

  it("TS: import attributes (with { type: 'json' })", async () => {
    const r = await parse(`import data from './x.json' with { type: 'json' };`, {
      filename: 'a.ts',
      lang: 'ts',
    });
    expect(r.errors).toEqual([]);
    const stmt = r.program?.body[0];
    if (stmt?.kind !== 'ImportDeclaration') {
      throw new Error('expected ImportDeclaration');
    }
    expect(stmt.source).toBe('./x.json');
  });

  it('TS: satisfies operator', async () => {
    const r = await parse('const a = b satisfies number;', { filename: 'a.ts', lang: 'ts' });
    expect(r.errors).toEqual([]);
  });

  it('TS: const type parameter — function id<const T>(x: T): T', async () => {
    const r = await parse('function id<const T>(x: T): T { return x; }', {
      filename: 'a.ts',
      lang: 'ts',
    });
    expect(r.errors).toEqual([]);
  });

  it('TSX: arrow function with type parameters', async () => {
    const r = await parse('const f = <T,>(x: T): T => x;', { filename: 'a.tsx', lang: 'tsx' });
    expect(r.errors).toEqual([]);
  });

  it('TS: class field', async () => {
    const r = await parse('class A { x = 1; }', { filename: 'a.ts', lang: 'ts' });
    expect(r.errors).toEqual([]);
  });

  it('TS: enum', async () => {
    const r = await parse('enum Color { Red, Green, Blue }', { filename: 'a.ts', lang: 'ts' });
    expect(r.errors).toEqual([]);
  });

  it('TS: namespace', async () => {
    const r = await parse('namespace N { export const x = 1; }', {
      filename: 'a.ts',
      lang: 'ts',
    });
    expect(r.errors).toEqual([]);
  });

  it('TS: dynamic import expression', async () => {
    const r = await parse(`const m = await import('./x');`, { filename: 'a.ts', lang: 'ts' });
    expect(r.errors).toEqual([]);
  });

  it("TS: UTF-8 multi-byte literal — '🚀' string keeps byte offsets correct", async () => {
    // Source bytes (UTF-8):
    //   c o n s t _ x _ = _ '  [4 bytes for 🚀]  '  ;
    //   0 1 2 3 4 5 6 7 8 9 10  11 12 13 14         15 16
    // total: 17 bytes. The closing `;` sits at byte 16; the half-open
    // range end of the whole statement is 17.
    const src = `const x = '\u{1F680}';`;
    const expectedBytes = Buffer.byteLength(src, 'utf8');
    expect(expectedBytes).toBe(17);
    const r = await parse(src, { filename: 'rocket.ts', lang: 'ts' });
    expect(r.errors).toEqual([]);
    const stmt = r.program?.body[0];
    if (stmt === undefined) throw new Error('expected one statement');
    // The whole VariableDeclaration spans the source. Assert start byte 0
    // and end byte equals source length; this confirms multi-byte arithmetic
    // threads through (a naive UTF-16-count implementation would yield 14).
    expect(stmt.range.start.byteOffset).toBe(0);
    expect(stmt.range.end.byteOffset).toBe(expectedBytes);
    // Column at end is 0-based UTF-16 code units. `🚀` is a surrogate pair
    // (2 UTF-16 units), so end column should sit on line 1.
    expect(stmt.range.end.line).toBe(1);
    expect(stmt.range.end.column).toBeGreaterThan(0);
  });
});
