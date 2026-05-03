/**
 * python-visitor.property.test.ts — Phase 4f T375 — fast-check invariants
 * for the Python visitor pipeline.
 *
 * 4 properties × 100 iterations each. Generators emit small well-formed
 * Python module fragments; canonical hand-written fixtures cover the
 * corners the generator misses. Mirrors the structure of
 * `packages/extract/src/__tests__/visitor-py-properties.test.ts` but
 * focuses on cross-cutting sorted-on-emit / determinism / idempotence
 * invariants that the SC-5 ledger asks for.
 */

import { fc, test as fctest } from '@fast-check/vitest';
import { buildPyInventory, parsePythonAst } from '@fugazi/extract';
import { describe, expect } from 'vitest';

const ID_ALPHABET = ['a', 'b', 'foo', 'bar', 'X', 'Y', 'Service'] as const;
const MOD_ALPHABET = ['os', 'sys', 'json', 'foo.bar', 'pkg'] as const;

const idArb = fc.constantFrom(...ID_ALPHABET);
const modArb = fc.constantFrom(...MOD_ALPHABET);

const statementArb = fc.oneof(
  modArb.map((m) => `import ${m}`),
  fc.tuple(idArb, modArb).map(([n, m]) => `from ${m} import ${n}`),
  idArb.map((n) => `def ${n}():\n    pass`),
  idArb.map((n) => `class ${n}:\n    pass`),
  fc.tuple(idArb, fc.integer({ min: 0, max: 9 })).map(([n, v]) => `${n} = ${v}`),
);

const programArb = fc.array(statementArb, { minLength: 1, maxLength: 6 }).map((s) => s.join('\n'));

// --------------------------------------------------------------------------
// Property A — Determinism: same source → byte-identical Inventory.
// --------------------------------------------------------------------------

describe('python-visitor: determinism', () => {
  fctest.prop([programArb], { numRuns: 100 })(
    'two parses of the same source yield byte-equal inventories',
    async (src) => {
      const a = await parsePythonAst(src, 'p.py');
      const b = await parsePythonAst(src, 'p.py');
      const invA = buildPyInventory(a.program, src, 'p.py');
      const invB = buildPyInventory(b.program, src, 'p.py');
      const sa = JSON.stringify(invA);
      const sb = JSON.stringify(invB);
      expect(sb).toBe(sa);
    },
    60_000,
  );
});

// --------------------------------------------------------------------------
// Property B — Idempotence: running visitor twice with shared parse → equal.
// --------------------------------------------------------------------------

describe('python-visitor: idempotence', () => {
  fctest.prop([programArb], { numRuns: 100 })(
    'two visitor runs over the same parsed AST produce equal inventories',
    async (src) => {
      const r = await parsePythonAst(src, 'p.py');
      const inv1 = buildPyInventory(r.program, src, 'p.py');
      const inv2 = buildPyInventory(r.program, src, 'p.py');
      expect(JSON.stringify(inv2)).toBe(JSON.stringify(inv1));
    },
    60_000,
  );
});

// --------------------------------------------------------------------------
// Property C — Sorted-on-emit: declarations / imports / usages all sorted by
// `range.start.byteOffset`.
// --------------------------------------------------------------------------

describe('python-visitor: sorted-on-emit', () => {
  fctest.prop([programArb], { numRuns: 100 })(
    'declarations are byteOffset-ordered',
    async (src) => {
      const r = await parsePythonAst(src, 'p.py');
      const inv = buildPyInventory(r.program, src, 'p.py');
      let prev = -1;
      for (const decl of inv.declarations) {
        const off = decl.range.start.byteOffset;
        expect(off).toBeGreaterThanOrEqual(prev);
        prev = off;
      }
    },
    60_000,
  );

  fctest.prop([programArb], { numRuns: 100 })(
    'imports are byteOffset-ordered',
    async (src) => {
      const r = await parsePythonAst(src, 'p.py');
      const inv = buildPyInventory(r.program, src, 'p.py');
      let prev = -1;
      for (const imp of inv.imports) {
        const off = imp.range.start.byteOffset;
        expect(off).toBeGreaterThanOrEqual(prev);
        prev = off;
      }
    },
    60_000,
  );
});

// --------------------------------------------------------------------------
// Property D — Frozen on emit: top-level Inventory and its arrays are frozen.
// --------------------------------------------------------------------------

describe('python-visitor: frozen on emit', () => {
  fctest.prop([programArb], { numRuns: 100 })(
    'inventory and its arrays are frozen',
    async (src) => {
      const r = await parsePythonAst(src, 'p.py');
      const inv = buildPyInventory(r.program, src, 'p.py');
      expect(Object.isFrozen(inv)).toBe(true);
      expect(Object.isFrozen(inv.declarations)).toBe(true);
      expect(Object.isFrozen(inv.imports)).toBe(true);
      expect(Object.isFrozen(inv.usages)).toBe(true);
    },
    60_000,
  );
});
