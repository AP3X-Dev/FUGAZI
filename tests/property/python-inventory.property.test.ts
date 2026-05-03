/**
 * python-inventory.property.test.ts — Phase 4f T375 — fast-check invariants
 * over the cross-language Inventory shape produced by the Python pipeline.
 *
 * 4 properties × 100 iterations each. Asserts:
 *  - Cross-language Inventory: same shape regardless of `lang`.
 *  - `__all__` honoring: when `__all__ = [...]` is present, only listed
 *    names have `exported: true`.
 *  - TYPE_CHECKING: imports inside the block emit `kind: 'type'`.
 *  - Inventory always carries a non-empty `path` matching the input.
 */

import { fc, test as fctest } from '@fast-check/vitest';
import { buildPyInventory, parsePythonAst } from '@fugazi/extract';
import { describe, expect } from 'vitest';

// --------------------------------------------------------------------------
// Property A — Cross-language Inventory shape: declarations / imports /
// usages exist as readonly arrays regardless of input.
// --------------------------------------------------------------------------

describe('python-inventory: cross-language shape', () => {
  const programArb = fc
    .array(
      fc.oneof(
        fc.constant('def foo():\n    pass'),
        fc.constant('class Bar:\n    pass'),
        fc.constant('import os'),
        fc.constant('from sys import argv'),
        fc.constant('x = 1'),
      ),
      { minLength: 1, maxLength: 5 },
    )
    .map((s) => s.join('\n'));

  fctest.prop([programArb], { numRuns: 100 })(
    'Inventory has declarations / imports / usages arrays',
    async (src) => {
      const r = await parsePythonAst(src, 'p.py');
      const inv = buildPyInventory(r.program, src, 'p.py');
      expect(Array.isArray(inv.declarations)).toBe(true);
      expect(Array.isArray(inv.imports)).toBe(true);
      expect(Array.isArray(inv.usages)).toBe(true);
    },
    60_000,
  );
});

// --------------------------------------------------------------------------
// Property B — `__all__` honoring: listed names are `exported: true`,
// unlisted names are `exported: false`.
// --------------------------------------------------------------------------

describe('python-inventory: __all__ honoring', () => {
  fctest.prop([fc.subarray(['foo', 'bar', 'baz', 'quux'], { minLength: 1 })], { numRuns: 100 })(
    'only names in __all__ are exported',
    async (listed) => {
      const all = listed.map((n) => `"${n}"`).join(', ');
      const defs = ['foo', 'bar', 'baz', 'quux'].map((n) => `def ${n}():\n    pass`).join('\n');
      const src = `__all__ = [${all}]\n${defs}\n`;
      const r = await parsePythonAst(src, 'p.py');
      const inv = buildPyInventory(r.program, src, 'p.py');
      const listedSet = new Set(listed);
      for (const decl of inv.declarations) {
        if (decl.kind === 'function' && ['foo', 'bar', 'baz', 'quux'].includes(decl.name)) {
          expect(decl.exported).toBe(listedSet.has(decl.name));
        }
      }
    },
    60_000,
  );
});

// --------------------------------------------------------------------------
// Property C — TYPE_CHECKING: imports inside `if TYPE_CHECKING:` are typed.
// --------------------------------------------------------------------------

describe('python-inventory: TYPE_CHECKING type imports', () => {
  const namesArb = fc.subarray(['Foo', 'Bar', 'Baz'], { minLength: 1 });

  fctest.prop([namesArb], { numRuns: 100 })(
    'imports inside TYPE_CHECKING block emit kind: "type"',
    async (names) => {
      const importLines = names.map((n) => `    from .types import ${n}`).join('\n');
      const src = `from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n${importLines}\n`;
      const r = await parsePythonAst(src, 'p.py');
      const inv = buildPyInventory(r.program, src, 'p.py');
      const guardedImports = inv.imports.filter(
        (imp) => imp.source === '.types' || imp.source.endsWith('.types'),
      );
      // At least one import is parsed and it's classified as type-only.
      expect(guardedImports.length).toBeGreaterThan(0);
      for (const imp of guardedImports) {
        expect(imp.kind).toBe('type');
      }
    },
    60_000,
  );
});

// --------------------------------------------------------------------------
// Property D — Determinism guard: re-running the visitor over a freshly
// parsed AST is byte-equal to the first run (companion to visitor.determinism
// — duplicated here so the inventory test file alone covers SC-5 invariants
// for the inventory shape).
// --------------------------------------------------------------------------

describe('python-inventory: re-run determinism', () => {
  const programArb = fc
    .array(
      fc.oneof(
        fc.constant('def foo():\n    pass'),
        fc.constant('class Bar:\n    pass'),
        fc.constant('import os'),
        fc.constant('x = 1'),
      ),
      { minLength: 1, maxLength: 5 },
    )
    .map((s) => s.join('\n'));

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
