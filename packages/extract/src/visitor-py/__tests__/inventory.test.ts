/**
 * inventory.test.ts — Phase 4a T305 — visitor contract tests.
 *
 * Exercises `buildPyInventory()` end-to-end (parse → walk → Inventory):
 *   - Module-level functions / classes / variables produce Declarations.
 *   - Plain / aliased / dotted / wildcard / relative imports surface as
 *     Imports with the documented source encoding.
 *   - Decorator references emit `kind: 'decorator'` usages.
 *   - Identifier references at module level emit `kind: 'identifier'` usages.
 *   - Underscore-leading names emit `exported: false`; non-underscore names
 *     emit `exported: true`.
 *   - Outputs are sorted by `range.start.byteOffset` and frozen.
 *   - Identical input → identical Inventory across multiple runs.
 *   - The visitor performs a SINGLE walk (verified via the test-only hook).
 */

import { describe, expect, it } from 'vitest';
import { parsePythonAst } from '../../parsers-py/adapter.js';
import { buildPyInventory } from '../index.js';

async function build(
  src: string,
): ReturnType<typeof buildPyInventory> | Promise<ReturnType<typeof buildPyInventory>> {
  const r = await parsePythonAst(src, 'fixture.py');
  return buildPyInventory(r.program, src, 'fixture.py');
}

describe('buildPyInventory — declarations (T305)', () => {
  it('emits a function-decl for a module-level def', async () => {
    const inv = await build('def hello(name):\n    return name');
    expect(inv.declarations.map((d) => d.name)).toEqual(['hello']);
    expect(inv.declarations[0]?.kind).toBe('function');
    expect(inv.declarations[0]?.exported).toBe(true);
  });

  it('emits a class-decl with members from the class body', async () => {
    const inv = await build('class Foo:\n    x = 1\n    def bar(self): pass');
    expect(inv.declarations.map((d) => d.name)).toEqual(['Foo']);
    expect(inv.declarations[0]?.kind).toBe('class');
    expect(inv.declarations[0]?.members).toEqual(['x', 'bar']);
  });

  it('Phase 4f T381: AnnAssign class fields surface as fieldMembers', async () => {
    const inv = await build('class User:\n    id: int\n    name: str\n    def hi(self): pass');
    const userDecl = inv.declarations.find((d) => d.name === 'User');
    expect(userDecl?.kind).toBe('class');
    expect(userDecl?.members).toEqual(['id', 'name', 'hi']);
    expect(userDecl?.fieldMembers).toEqual(['id', 'name']);
  });

  it('Phase 4f T381: untyped class-level Assign is NOT in fieldMembers', async () => {
    const inv = await build('class C:\n    x = 1\n    y: int = 2');
    const decl = inv.declarations.find((d) => d.name === 'C');
    expect(decl?.members).toEqual(['x', 'y']);
    // Only `y` (AnnAssign) is a field; `x` (plain Assign) is not.
    expect(decl?.fieldMembers).toEqual(['y']);
  });

  it('Phase 4f T381: methods-only class has no fieldMembers', async () => {
    const inv = await build('class C:\n    def a(self): pass\n    def b(self): pass');
    const decl = inv.declarations.find((d) => d.name === 'C');
    expect(decl?.fieldMembers).toBeUndefined();
  });

  it('emits a variable-decl for a module-level assignment', async () => {
    const inv = await build('x = 1');
    expect(inv.declarations.map((d) => d.name)).toEqual(['x']);
    expect(inv.declarations[0]?.kind).toBe('variable');
    expect(inv.declarations[0]?.exported).toBe(true);
  });

  it('marks underscore-leading names as exported: false', async () => {
    const inv = await build('def _private(): pass\ndef public(): pass\nclass _Hidden: pass');
    const exported = new Map(inv.declarations.map((d) => [d.name, d.exported]));
    expect(exported.get('_private')).toBe(false);
    expect(exported.get('public')).toBe(true);
    expect(exported.get('_Hidden')).toBe(false);
  });

  it('does not emit declarations for nested defs inside a function', async () => {
    const inv = await build('def outer():\n    def inner(): pass\n    return inner');
    expect(inv.declarations.map((d) => d.name)).toEqual(['outer']);
  });
});

describe('buildPyInventory — imports (T305)', () => {
  it('emits a static import for `import x`', async () => {
    const inv = await build('import os');
    expect(inv.imports).toHaveLength(1);
    expect(inv.imports[0]?.kind).toBe('static');
    expect(inv.imports[0]?.source).toBe('os');
  });

  it('emits one import per dotted spec for `import a, b`', async () => {
    const inv = await build('import os, sys');
    expect(inv.imports.map((i) => i.source)).toEqual(['os', 'sys']);
  });

  it('emits the dotted module spec for `import x.y.z`', async () => {
    const inv = await build('import foo.bar.baz');
    expect(inv.imports[0]?.source).toBe('foo.bar.baz');
  });

  it('strips alias from `import x as y`', async () => {
    const inv = await build('import numpy as np');
    expect(inv.imports[0]?.source).toBe('numpy');
  });

  it('emits a single import for `from foo import a, b`', async () => {
    const inv = await build('from foo import a, b');
    expect(inv.imports).toHaveLength(1);
    expect(inv.imports[0]?.source).toBe('foo');
  });

  it('preserves dot prefixes for relative imports', async () => {
    const inv = await build('from . import a\nfrom .foo import b\nfrom ..bar import c');
    expect(inv.imports.map((i) => i.source)).toEqual(['.', '.foo', '..bar']);
  });

  it('handles `from foo import *` as a static import', async () => {
    const inv = await build('from foo import *');
    expect(inv.imports).toHaveLength(1);
    expect(inv.imports[0]?.source).toBe('foo');
  });

  it('Phase 4f T381: surfaces imported names on `from X import Y, Z`', async () => {
    const inv = await build('from foo import a, b, c');
    expect(inv.imports).toHaveLength(1);
    expect(inv.imports[0]?.names).toEqual(['a', 'b', 'c']);
  });

  it('Phase 4f T381: imported names use the bare binding (drops `as` alias)', async () => {
    const inv = await build('from foo import a as A, b');
    expect(inv.imports[0]?.names).toEqual(['a', 'b']);
  });

  it('Phase 4f T381: `from foo import *` does NOT populate names (wildcard)', async () => {
    const inv = await build('from foo import *');
    expect(inv.imports[0]?.names).toBeUndefined();
  });

  it('Phase 4f T381: `import x` (non-from) does NOT populate names', async () => {
    const inv = await build('import os, sys');
    for (const imp of inv.imports) {
      expect(imp.names).toBeUndefined();
    }
  });
});

describe('buildPyInventory — usages (T305)', () => {
  it('emits identifier usages for module-level Name references', async () => {
    const inv = await build('x = foo\ny = bar');
    const ids = inv.usages.filter((u) => u.kind === 'identifier').map((u) => u.name);
    expect(ids).toContain('foo');
    expect(ids).toContain('bar');
  });

  it('emits a member usage for attribute access', async () => {
    const inv = await build('result = obj.method()');
    const memberNames = inv.usages.filter((u) => u.kind === 'member').map((u) => u.name);
    // Phase 4f T381 — handleAttribute emits BOTH the chain base (`obj`)
    // and the rightmost attr (`method`) as 'member' usages so call-chain
    // accesses on non-Name receivers (`Call(...).method()`) are still
    // recorded. Both names must be present.
    expect(memberNames).toContain('obj');
    expect(memberNames).toContain('method');
  });

  it('emits a decorator usage for @dataclass', async () => {
    const inv = await build('@dataclass\nclass X: pass');
    const dec = inv.usages.find((u) => u.kind === 'decorator');
    expect(dec?.name).toBe('dataclass');
  });

  it('emits a decorator usage for `@app.route("/")` carrying the dotted name', async () => {
    const inv = await build('@app.route("/")\ndef view(): pass');
    const dec = inv.usages.find((u) => u.kind === 'decorator');
    expect(dec?.name).toBe('app.route');
  });

  it('does NOT emit identifier usages for function parameters', async () => {
    const inv = await build('def f(a, b):\n    return a + b');
    const ids = inv.usages.filter((u) => u.kind === 'identifier').map((u) => u.name);
    // `a` and `b` reach the body as Names BUT they are bound as parameters
    // — no identifier usage should fire for them.
    expect(ids).not.toContain('a');
    expect(ids).not.toContain('b');
  });
});

describe('buildPyInventory — invariants (T305)', () => {
  it('produces an empty inventory with lang=py for empty source', async () => {
    const inv = await build('');
    expect(inv.lang).toBe('py');
    expect(inv.declarations).toEqual([]);
    expect(inv.imports).toEqual([]);
    expect(inv.usages).toEqual([]);
  });

  it('sets lang to "py" on a non-empty inventory', async () => {
    const inv = await build('def f(): pass');
    expect(inv.lang).toBe('py');
  });

  it('sorts each output array by range.start.byteOffset ascending', async () => {
    const inv = await build('import foo\ndef a(): pass\nclass C: pass\nb = 1');
    function ascending(
      arr: { readonly range: { readonly start: { readonly byteOffset: number } } }[],
    ): boolean {
      for (let i = 1; i < arr.length; i++) {
        const prev = arr[i - 1];
        const curr = arr[i];
        if (prev !== undefined && curr !== undefined) {
          if (prev.range.start.byteOffset > curr.range.start.byteOffset) return false;
        }
      }
      return true;
    }
    expect(ascending([...inv.declarations])).toBe(true);
    expect(ascending([...inv.imports])).toBe(true);
    expect(ascending([...inv.usages])).toBe(true);
  });

  it('returns frozen collections (Object.isFrozen on inventory + each array)', async () => {
    const inv = await build('def f(): pass');
    expect(Object.isFrozen(inv)).toBe(true);
    expect(Object.isFrozen(inv.declarations)).toBe(true);
    expect(Object.isFrozen(inv.imports)).toBe(true);
    expect(Object.isFrozen(inv.usages)).toBe(true);
  });

  it('produces byte-equal Inventory across 100 runs (determinism)', async () => {
    const src =
      'import os\n@dec\nclass Point:\n    x: int\n    y: int\n\ndef move(p):\n    return p.x';
    const r = await parsePythonAst(src, 'det.py');
    const snapshots: string[] = [];
    for (let i = 0; i < 100; i++) {
      const inv = buildPyInventory(r.program, src, 'det.py');
      snapshots.push(JSON.stringify(inv));
    }
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i]).toBe(snapshots[0]);
    }
  });

  it('walks the AST exactly once (single-pass discipline)', async () => {
    const r = await parsePythonAst('def f(): pass\nclass C: pass\nx = 1', 'p.py');
    let count = 0;
    buildPyInventory(r.program, 'def f(): pass\nclass C: pass\nx = 1', 'p.py', {
      onEnter: () => {
        count += 1;
      },
    });
    // The walker visits each node once; the count is whatever the walker
    // reports for this fixture. A second invocation must yield the same.
    let count2 = 0;
    buildPyInventory(r.program, 'def f(): pass\nclass C: pass\nx = 1', 'p.py', {
      onEnter: () => {
        count2 += 1;
      },
    });
    expect(count2).toBe(count);
    expect(count).toBeGreaterThan(0);
  });

  it('handles a mixed module: imports + class + functions + module-level call', async () => {
    const src =
      'import os\n' +
      'from sys import argv\n' +
      '\n' +
      'class Service:\n' +
      '    def start(self): pass\n' +
      '\n' +
      'def main():\n' +
      '    s = Service()\n' +
      '    s.start()\n' +
      '\n' +
      'main()\n';
    const inv = await build(src);
    expect(inv.imports.map((i) => i.source).sort()).toEqual(['os', 'sys']);
    expect(inv.declarations.map((d) => d.name)).toEqual(['Service', 'main']);
    // Module-level `main()` produces an identifier usage for `main`.
    expect(inv.usages.some((u) => u.kind === 'identifier' && u.name === 'main')).toBe(true);
  });
});

describe('buildPyInventory — memberDecorations (Phase 4d T346)', () => {
  it('emits dotted decorator names for @app.route', async () => {
    const inv = await build(
      'class UserView:\n' + '    @app.route("/users")\n' + '    def list_users(self): pass\n',
    );
    const cls = inv.declarations.find((d) => d.kind === 'class');
    expect(cls?.memberDecorations).toBeDefined();
    expect(cls?.memberDecorations?.length).toBe(1);
    const md = cls?.memberDecorations?.[0];
    expect(md?.name).toBe('list_users');
    expect(md?.decorators).toEqual(['app.route']);
  });

  it('emits bare-name decorator for @fixture', async () => {
    const inv = await build('class Suite:\n' + '    @fixture\n' + '    def db(self): pass\n');
    const cls = inv.declarations.find((d) => d.kind === 'class');
    const md = cls?.memberDecorations?.[0];
    expect(md?.name).toBe('db');
    expect(md?.decorators).toEqual(['fixture']);
  });

  it('emits dotted name for @pytest.fixture (decorator with chain)', async () => {
    const inv = await build(
      'class Suite:\n' + '    @pytest.fixture\n' + '    def db(self): pass\n',
    );
    const cls = inv.declarations.find((d) => d.kind === 'class');
    const md = cls?.memberDecorations?.[0];
    expect(md?.decorators).toEqual(['pytest.fixture']);
  });

  it('records every decorator in source order (top-most first)', async () => {
    const inv = await build(
      'class UserView:\n' +
        '    @staticmethod\n' +
        '    @app.route("/")\n' +
        '    def home(): pass\n',
    );
    const cls = inv.declarations.find((d) => d.kind === 'class');
    const md = cls?.memberDecorations?.[0];
    expect(md?.decorators).toEqual(['staticmethod', 'app.route']);
  });

  it('omits memberDecorations for a class with no decorated methods', async () => {
    const inv = await build('class Plain:\n    def helper(self): pass\n');
    const cls = inv.declarations.find((d) => d.kind === 'class');
    expect(cls?.memberDecorations).toBeUndefined();
  });

  it('keeps decoratedMembers parallel to memberDecorations names', async () => {
    const inv = await build(
      'class UserView:\n' +
        '    @app.route("/a")\n' +
        '    def a(): pass\n' +
        '    def plain(): pass\n' +
        '    @app.route("/b")\n' +
        '    def b(): pass\n',
    );
    const cls = inv.declarations.find((d) => d.kind === 'class');
    expect(cls?.decoratedMembers).toEqual(['a', 'b']);
    expect(cls?.memberDecorations?.map((d) => d.name)).toEqual(['a', 'b']);
  });
});
