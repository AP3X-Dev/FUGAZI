/**
 * visitor-py-properties.test.ts — Phase 4a T311 — fast-check property tests
 * for the Python visitor pipeline.
 *
 * 12 properties × 100 iterations each (where the iteration count is too slow
 * we drop to 50; documented per property). The arbitrary produces small,
 * well-formed Python source fragments — generators are kept simple rather
 * than attempting to model the full Python grammar; canonical hand-written
 * fixtures cover the corners the generator misses.
 *
 * Spec refs: design-doc §7.4 (visitor invariants), PRP NFR-1 (determinism),
 * PRP FR-D3 (immutability), Phase 4a T306 (`__all__`), T307 (TYPE_CHECKING).
 */

import { fc, test as fctest } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';
import { parsePythonAst } from '../parsers-py/adapter.js';
import { buildPyInventory } from '../visitor-py/index.js';

// --------------------------------------------------------------------------
// Source generators — small alphabets keep parses cheap and deterministic.
// --------------------------------------------------------------------------

const ID_ALPHABET = ['a', 'b', 'foo', 'bar', 'X', 'Y', 'Service', 'helper'] as const;
const MOD_ALPHABET = ['os', 'sys', 'json', 'foo', 'bar', 'foo.bar'] as const;

const idArb = fc.constantFrom(...ID_ALPHABET);
const modArb = fc.constantFrom(...MOD_ALPHABET);

/** A single statement template producing a syntactically valid module-level
 *  Python statement. */
const statementArb = fc.oneof(
  modArb.map((m) => `import ${m}`),
  fc.tuple(idArb, modArb).map(([n, m]) => `import ${m} as ${n}`),
  fc.tuple(idArb, modArb).map(([n, m]) => `from ${m} import ${n}`),
  modArb.map((m) => `from ${m} import *`),
  idArb.map((n) => `def ${n}():\n    pass`),
  idArb.map((n) => `async def ${n}():\n    pass`),
  idArb.map((n) => `class ${n}:\n    pass`),
  fc.tuple(idArb, fc.integer({ min: 0, max: 10 })).map(([n, v]) => `${n} = ${v}`),
);

const programArb = fc.array(statementArb, { minLength: 1, maxLength: 5 }).map((s) => s.join('\n'));

const FIXED_FIXTURES: readonly string[] = [
  'def foo():\n    return 1',
  'class Bar:\n    x = 1\n    def m(self): pass',
  'import os\nfrom sys import argv',
  '@dataclass\nclass Point:\n    x: int\n    y: int',
  'async def fetch():\n    return None',
  '__all__ = ["foo"]\ndef foo(): pass\ndef bar(): pass',
  'from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    import os',
];

// --------------------------------------------------------------------------
// Property 1 — Termination: visitor returns within timeout for any well-formed
// generated source.
// --------------------------------------------------------------------------

describe('property 1: visitor terminates on every generated input', () => {
  fctest.prop([programArb], { numRuns: 100 })(
    'buildPyInventory returns within vitest timeout',
    async (src) => {
      const r = await parsePythonAst(src, 'p.py');
      const inv = buildPyInventory(r.program, src, 'p.py');
      expect(inv).toBeDefined();
      expect(inv.declarations).toBeDefined();
      expect(inv.imports).toBeDefined();
      expect(inv.usages).toBeDefined();
    },
    60_000,
  );
});

// --------------------------------------------------------------------------
// Property 2 — Non-empty names for every Declaration.name and Import.source.
// --------------------------------------------------------------------------

describe('property 2: non-empty Declaration.name and Import.source', () => {
  fctest.prop([programArb], { numRuns: 100 })(
    'every emitted Declaration.name and Import.source has length > 0',
    async (src) => {
      const r = await parsePythonAst(src, 'p.py');
      const inv = buildPyInventory(r.program, src, 'p.py');
      expect(inv.declarations.every((d) => d.name.length > 0)).toBe(true);
      expect(inv.imports.every((i) => i.source.length > 0)).toBe(true);
    },
    60_000,
  );
});

// --------------------------------------------------------------------------
// Property 3 — Determinism: same source → byte-identical Inventory.
// --------------------------------------------------------------------------

describe('property 3: determinism — same source → byte-identical Inventory', () => {
  fctest.prop([programArb], { numRuns: 100 })(
    'JSON.stringify(buildPyInventory) is byte-equal across two runs',
    async (src) => {
      const r1 = await parsePythonAst(src, 'p.py');
      const r2 = await parsePythonAst(src, 'p.py');
      const a = buildPyInventory(r1.program, src, 'p.py');
      const b = buildPyInventory(r2.program, src, 'p.py');
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    },
    60_000,
  );
});

// --------------------------------------------------------------------------
// Property 4 — Idempotence: running visitor twice on the same parsed program
// yields identical Inventory.
// --------------------------------------------------------------------------

describe('property 4: idempotence — visitor twice → identical Inventory', () => {
  fctest.prop([programArb], { numRuns: 100 })(
    'two consecutive buildPyInventory(program) calls are byte-equal',
    async (src) => {
      const r = await parsePythonAst(src, 'p.py');
      const a = buildPyInventory(r.program, src, 'p.py');
      const b = buildPyInventory(r.program, src, 'p.py');
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    },
    60_000,
  );
});

// --------------------------------------------------------------------------
// Property 5 — BOM tolerance: ﻿ prefix produces same Inventory minus the
// BOM byte (declarations / imports unchanged).
// --------------------------------------------------------------------------

describe('property 5: BOM tolerance', () => {
  fctest.prop([programArb], { numRuns: 50 })(
    'BOM-prefixed source yields the same inventory shape as un-prefixed',
    async (src) => {
      const plain = await parsePythonAst(src, 'p.py');
      const withBom = await parsePythonAst(`﻿${src}`, 'p.py');
      const a = buildPyInventory(plain.program, src, 'p.py');
      const b = buildPyInventory(withBom.program, `﻿${src}`, 'p.py');
      expect(a.declarations.map((d) => d.name)).toEqual(b.declarations.map((d) => d.name));
      expect(a.imports.map((i) => i.source)).toEqual(b.imports.map((i) => i.source));
    },
    60_000,
  );
});

// --------------------------------------------------------------------------
// Property 6 — Shebang tolerance.
// --------------------------------------------------------------------------

describe('property 6: shebang tolerance', () => {
  fctest.prop([programArb], { numRuns: 50 })(
    '#!/usr/bin/env python3 prefix preserves declaration/import shape',
    async (src) => {
      const plain = await parsePythonAst(src, 'p.py');
      const withShebang = await parsePythonAst(`#!/usr/bin/env python3\n${src}`, 'p.py');
      const a = buildPyInventory(plain.program, src, 'p.py');
      const b = buildPyInventory(withShebang.program, `#!/usr/bin/env python3\n${src}`, 'p.py');
      expect(a.declarations.map((d) => d.name)).toEqual(b.declarations.map((d) => d.name));
      expect(a.imports.map((i) => i.source)).toEqual(b.imports.map((i) => i.source));
    },
    60_000,
  );
});

// --------------------------------------------------------------------------
// Property 7 — Decorator preservation (canonical fixture).
// --------------------------------------------------------------------------

describe('property 7: decorator preservation', () => {
  it.each([
    {
      src: '@dataclass\nclass Foo:\n    pass',
      expectedDecorator: 'dataclass',
    },
    {
      src: '@app.route("/")\ndef view():\n    pass',
      expectedDecorator: 'app.route',
    },
    {
      src: '@cache\n@app.get\ndef handler():\n    pass',
      expectedDecorator: 'cache',
    },
  ])('emits a decorator usage for %s', async ({ src, expectedDecorator }) => {
    const r = await parsePythonAst(src, 'p.py');
    const inv = buildPyInventory(r.program, src, 'p.py');
    const dec = inv.usages.filter((u) => u.kind === 'decorator').map((u) => u.name);
    expect(dec).toContain(expectedDecorator);
  });
});

// --------------------------------------------------------------------------
// Property 8 — Async-def detection: parser surfaces `async def` as
// AsyncFunctionDef, NOT FunctionDef. Visitor still emits a function-decl.
// --------------------------------------------------------------------------

describe('property 8: async-def is parsed as AsyncFunctionDef', () => {
  it.each(['async def fetch():\n    pass', 'async def go():\n    return None'])(
    'emits a function declaration for async def: %s',
    async (src) => {
      const r = await parsePythonAst(src, 'p.py');
      // The walker sees AsyncFunctionDef nodes — find one in program.body.
      const stmt = r.program.body[0];
      expect(stmt?.kind).toBe('AsyncFunctionDef');
      const inv = buildPyInventory(r.program, src, 'p.py');
      expect(inv.declarations.length).toBe(1);
      expect(inv.declarations[0]?.kind).toBe('function');
    },
  );
});

// --------------------------------------------------------------------------
// Property 9 — `__all__` honoring (canonical fixtures).
// --------------------------------------------------------------------------

describe('property 9: __all__ honoring (T306)', () => {
  it('only listed names are exported when __all__ is non-empty', async () => {
    const src = '__all__ = ["foo"]\ndef foo(): pass\ndef bar(): pass';
    const r = await parsePythonAst(src, 'p.py');
    const inv = buildPyInventory(r.program, src, 'p.py');
    const exp = new Map(inv.declarations.map((d) => [d.name, d.exported]));
    expect(exp.get('foo')).toBe(true);
    expect(exp.get('bar')).toBe(false);
  });

  it('falls back to underscore-heuristic when __all__ is absent', async () => {
    const src = 'def foo(): pass\ndef _hidden(): pass';
    const r = await parsePythonAst(src, 'p.py');
    const inv = buildPyInventory(r.program, src, 'p.py');
    const exp = new Map(inv.declarations.map((d) => [d.name, d.exported]));
    expect(exp.get('foo')).toBe(true);
    expect(exp.get('_hidden')).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Property 10 — Type-only import classification (T307).
// --------------------------------------------------------------------------

describe('property 10: TYPE_CHECKING block produces kind: type imports', () => {
  it('imports inside `if TYPE_CHECKING:` emit kind: type', async () => {
    const src = 'from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    import os';
    const r = await parsePythonAst(src, 'p.py');
    const inv = buildPyInventory(r.program, src, 'p.py');
    const os = inv.imports.find((i) => i.source === 'os');
    expect(os?.kind).toBe('type');
  });

  it('imports outside the block stay kind: static', async () => {
    const src = 'from typing import TYPE_CHECKING\nimport sys\nif TYPE_CHECKING:\n    import os';
    const r = await parsePythonAst(src, 'p.py');
    const inv = buildPyInventory(r.program, src, 'p.py');
    const sys = inv.imports.find((i) => i.source === 'sys');
    expect(sys?.kind).toBe('static');
  });
});

// --------------------------------------------------------------------------
// Property 11 — Sorted-on-emit by range.start.byteOffset, then name.
// --------------------------------------------------------------------------

describe('property 11: sorted-on-emit (byteOffset ascending)', () => {
  fctest.prop([programArb], { numRuns: 100 })(
    'declarations / imports / usages are all sorted ascending by byteOffset',
    async (src) => {
      const r = await parsePythonAst(src, 'p.py');
      const inv = buildPyInventory(r.program, src, 'p.py');
      function ascending<
        T extends { readonly range: { readonly start: { readonly byteOffset: number } } },
      >(arr: readonly T[]): boolean {
        for (let i = 1; i < arr.length; i++) {
          const prev = arr[i - 1];
          const curr = arr[i];
          if (prev !== undefined && curr !== undefined) {
            if (prev.range.start.byteOffset > curr.range.start.byteOffset) return false;
          }
        }
        return true;
      }
      expect(ascending(inv.declarations)).toBe(true);
      expect(ascending(inv.imports)).toBe(true);
      expect(ascending(inv.usages)).toBe(true);
    },
    60_000,
  );
});

// --------------------------------------------------------------------------
// Property 12 — Frozen on emit: Inventory and each sub-array are frozen.
// --------------------------------------------------------------------------

describe('property 12: frozen on emit', () => {
  fctest.prop([programArb], { numRuns: 100 })(
    'Object.isFrozen(inv) and frozen sub-arrays for declarations / imports / usages',
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

  it.each(FIXED_FIXTURES)('frozen on canonical fixture: %s', async (src) => {
    const r = await parsePythonAst(src, 'p.py');
    const inv = buildPyInventory(r.program, src, 'p.py');
    expect(Object.isFrozen(inv)).toBe(true);
    expect(Object.isFrozen(inv.declarations)).toBe(true);
    expect(Object.isFrozen(inv.imports)).toBe(true);
    expect(Object.isFrozen(inv.usages)).toBe(true);
  });
});
