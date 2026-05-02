/**
 * complexity.test.ts — Phase 3c.7 (T077-test) acceptance suite.
 *
 * 22 source-fixture cases covering McCabe cyclomatic, Sonar cognitive, and
 * Maintainability Index, plus 3 structural invariants (determinism, no
 * `Math.random`, empty-program safety).
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Program } from '../ast/kinds.js';
import { type FileComplexity, computeComplexity } from '../complexity/index.js';
import { parse } from '../parsers/oxc.js';
import { type Manifest, __setManifestForTest } from '../wasm/integrity.js';
import { __clearWasmCacheForTest } from '../wasm/load.js';

const REAL_MANIFEST: Manifest = {
  blobs: {
    swc: {
      path: 'node_modules/@swc/wasm/wasm_bg.wasm',
      sha256: 'a400243367e0731a958f97e4cafd76b7282bd361c6a13e65d1d177d32ee125ec',
    },
  },
};

beforeEach(() => {
  __setManifestForTest(REAL_MANIFEST);
  __clearWasmCacheForTest();
});

afterEach(() => {
  __setManifestForTest(null);
  __clearWasmCacheForTest();
});

async function parseProgram(source: string): Promise<Program> {
  const result = await parse(source, { filename: 'fixture.ts', lang: 'ts' });
  expect(result.errors).toEqual([]);
  if (result.program === null) {
    throw new Error('expected non-null program');
  }
  return result.program;
}

async function analyze(source: string): Promise<FileComplexity> {
  const program = await parseProgram(source);
  return computeComplexity(program, source);
}

function findFn(result: FileComplexity, name: string): FileComplexity['functions'][number] {
  const fn = result.functions.find((f) => f.name === name);
  if (fn === undefined) {
    throw new Error(
      `function '${name}' not found in: ${result.functions.map((f) => f.name).join(', ')}`,
    );
  }
  return fn;
}

// ---------------------------------------------------------------------------
// Structural invariants
// ---------------------------------------------------------------------------

describe('complexity — structural invariants', () => {
  it('determinism: byte-equal JSON across repeated computations', async () => {
    const source = `
      function nontrivial(x: number, y: number) {
        if (x > 0) {
          for (let i = 0; i < x; i++) {
            if (y && i > 5) return true;
          }
        } else if (x < 0) {
          while (y) y--;
        }
        return x ? 1 : 0;
      }
    `;
    const program = await parseProgram(source);
    const a = computeComplexity(program, source);
    const b = computeComplexity(program, source);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('no Math.random in any complexity source file (NFR-1)', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(here, '..', 'complexity', 'index.ts'),
      resolve(here, '..', 'complexity', 'cyclomatic.ts'),
      resolve(here, '..', 'complexity', 'cognitive.ts'),
      resolve(here, '..', 'complexity', 'mi.ts'),
    ];
    for (const path of candidates) {
      const text = await readFile(path, 'utf8');
      const probe = ['Math', '.', 'random'].join('');
      expect(text).not.toContain(probe);
    }
  });

  it('empty program produces empty functions array and zero aggregate', async () => {
    const result = await analyze('');
    expect(result.functions).toEqual([]);
    expect(result.aggregate.cyclomatic).toBe(0);
    expect(result.aggregate.cognitive).toBe(0);
    expect(result.aggregate.loc).toBe(0);
    // MI of an empty file collapses to the maximum value 100 by convention.
    expect(result.aggregate.maintainabilityIndex).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 22 fixtures
// ---------------------------------------------------------------------------

describe('complexity — fixtures', () => {
  it('1. simple function: cyclomatic=1, cognitive=0', async () => {
    const r = await analyze('function f() { return 1; }');
    const f = findFn(r, 'f');
    expect(f.cyclomatic).toBe(1);
    expect(f.cognitive).toBe(0);
  });

  it('2. single if: cyclomatic=2, cognitive=1', async () => {
    const r = await analyze('function f(x: number) { if (x) { return 1; } return 0; }');
    const f = findFn(r, 'f');
    expect(f.cyclomatic).toBe(2);
    expect(f.cognitive).toBe(1);
  });

  it('3. if/else: cyclomatic=2, cognitive=1 (else does not add)', async () => {
    const r = await analyze('function f(x: number) { if (x) { return 1; } else { return 0; } }');
    const f = findFn(r, 'f');
    expect(f.cyclomatic).toBe(2);
    expect(f.cognitive).toBe(1);
  });

  it('4. if/else if/else: cyclomatic=3, cognitive=2', async () => {
    const r = await analyze(
      'function f(x: number) { if (x > 0) { return 1; } else if (x < 0) { return -1; } else { return 0; } }',
    );
    const f = findFn(r, 'f');
    expect(f.cyclomatic).toBe(3);
    expect(f.cognitive).toBe(2);
  });

  it('5. for loop: cyclomatic=2', async () => {
    const r = await analyze('function f() { for (let i = 0; i < 10; i++) { } }');
    expect(findFn(r, 'f').cyclomatic).toBe(2);
  });

  it('6. while loop: cyclomatic=2', async () => {
    const r = await analyze('function f() { let x = 1; while (x > 0) { x = 0; } }');
    expect(findFn(r, 'f').cyclomatic).toBe(2);
  });

  it('7. do-while: cyclomatic=2', async () => {
    const r = await analyze('function f() { let x = 0; do { x = 1; } while (x < 10); }');
    expect(findFn(r, 'f').cyclomatic).toBe(2);
  });

  it('8. switch with 3 cases: cyclomatic=4', async () => {
    const r = await analyze(
      'function f(x: number) { switch (x) { case 1: break; case 2: break; case 3: break; default: break; } }',
    );
    expect(findFn(r, 'f').cyclomatic).toBe(4);
  });

  it('9. ternary: cyclomatic=2', async () => {
    const r = await analyze('function f(x: number) { return x > 0 ? 1 : 0; }');
    expect(findFn(r, 'f').cyclomatic).toBe(2);
  });

  it('10. && short-circuit: cyclomatic=2', async () => {
    const r = await analyze('function f(a: boolean, b: boolean) { return a && b; }');
    expect(findFn(r, 'f').cyclomatic).toBe(2);
  });

  it('11. || short-circuit: cyclomatic=2', async () => {
    const r = await analyze('function f(a: boolean, b: boolean) { return a || b; }');
    expect(findFn(r, 'f').cyclomatic).toBe(2);
  });

  it('12. ?? short-circuit: cyclomatic=2', async () => {
    const r = await analyze('function f(a: number) { return a ?? 0; }');
    expect(findFn(r, 'f').cyclomatic).toBe(2);
  });

  it('13. try/catch: cyclomatic=2 (catch adds 1)', async () => {
    const r = await analyze('function f() { try { return 1; } catch (e) { return 0; } }');
    expect(findFn(r, 'f').cyclomatic).toBe(2);
  });

  it('14. nested if: cognitive > cyclomatic (nesting penalty)', async () => {
    const r = await analyze(
      `function f(x: number, y: number, z: number) {
        if (x) {
          if (y) {
            if (z) {
              return 1;
            }
          }
        }
        return 0;
      }`,
    );
    const f = findFn(r, 'f');
    // 3 ifs → cyclomatic = 4 (1 + 3). Cognitive = 1 + 2 + 3 = 6.
    expect(f.cyclomatic).toBe(4);
    expect(f.cognitive).toBe(6);
    expect(f.cognitive).toBeGreaterThan(f.cyclomatic);
  });

  it('15. recursive call adds +1 to cognitive', async () => {
    const r = await analyze('function f(n: number): number { return f(n - 1); }');
    const f = findFn(r, 'f');
    // Cognitive: only the recursion bumps complexity (+1), no control flow.
    expect(f.cognitive).toBe(1);
  });

  it('16. multiple functions: aggregate sums', async () => {
    const r = await analyze(
      'function a(x: number) { if (x) return 1; return 0; } function b(y: number) { if (y) return 2; return 0; }',
    );
    expect(r.functions.length).toBe(2);
    expect(r.aggregate.cyclomatic).toBe(findFn(r, 'a').cyclomatic + findFn(r, 'b').cyclomatic);
    expect(r.aggregate.cognitive).toBe(findFn(r, 'a').cognitive + findFn(r, 'b').cognitive);
  });

  it('17. class method: qualified name <Class>.<method>', async () => {
    const r = await analyze('class Foo { bar() { return 1; } baz() { return 2; } }');
    const names = r.functions.map((f) => f.name);
    expect(names).toContain('Foo.bar');
    expect(names).toContain('Foo.baz');
  });

  it('18. long function has lower MI than short for same cyclomatic', async () => {
    const shortSrc = 'function s() { return 1; }';
    const longBody = 'const a = 1;\n'.repeat(40);
    const longSrc = `function l() {\n${longBody}return 1;\n}`;
    const sr = await analyze(shortSrc);
    const lr = await analyze(longSrc);
    expect(findFn(sr, 's').maintainabilityIndex).toBeGreaterThan(
      findFn(lr, 'l').maintainabilityIndex,
    );
  });

  it('19. function with no operators: Halstead fallback works', async () => {
    const r = await analyze('function f() { return 1; }');
    const f = findFn(r, 'f');
    expect(Number.isFinite(f.maintainabilityIndex)).toBe(true);
    expect(f.maintainabilityIndex).toBeGreaterThanOrEqual(0);
    expect(f.maintainabilityIndex).toBeLessThanOrEqual(100);
  });

  it('20. empty function: cyclomatic=1, cognitive=0, MI computed', async () => {
    const r = await analyze('function f() {}');
    const f = findFn(r, 'f');
    expect(f.cyclomatic).toBe(1);
    expect(f.cognitive).toBe(0);
    expect(Number.isFinite(f.maintainabilityIndex)).toBe(true);
  });

  it('21. file aggregate: sums + mean', async () => {
    const r = await analyze(
      'function a(x: number) { if (x) return 1; return 0; } function b(y: number) { if (y) return 2; return 0; }',
    );
    const a = findFn(r, 'a');
    const b = findFn(r, 'b');
    expect(r.aggregate.cyclomatic).toBe(a.cyclomatic + b.cyclomatic);
    expect(r.aggregate.cognitive).toBe(a.cognitive + b.cognitive);
    expect(r.aggregate.loc).toBe(a.loc + b.loc);
    const expectedMean = Number(((a.maintainabilityIndex + b.maintainabilityIndex) / 2).toFixed(6));
    expect(r.aggregate.maintainabilityIndex).toBe(expectedMean);
  });

  it('22. MI numeric stability: same source twice, byte-equal JSON', async () => {
    const source =
      'function f(x: number) { if (x) return 1; for (let i = 0; i < x; i++) {} return 0; }';
    const r1 = await analyze(source);
    const r2 = await analyze(source);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
