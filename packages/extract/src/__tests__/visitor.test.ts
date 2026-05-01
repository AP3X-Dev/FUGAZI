/**
 * visitor.test.ts — Phase 3c.4 Dispatch B (T063-test) acceptance suite.
 *
 * Covers the single-pass visitor pipeline:
 *
 *   1.   Single-pass discipline — `onEnter` invocation count matches an
 *        independent `childrenOf` recursion. (Asserted by parsing each fixture
 *        and walking the resulting Program twice — once via the visitor and
 *        once via a parallel recursive baseline — counting visited nodes.)
 *   2.   No legacy sentinel — none of the visitor source files contain the
 *        joined-token used by the original Fallow Rust pipeline. The token is
 *        constructed by concatenation here so this test file does NOT itself
 *        trip the SC-17 forbidden-strings gate.
 *   3.   Determinism — three representative fixtures parsed twice produce
 *        byte-equal JSON.stringify(inventory).
 *
 * Then 30 source-fixture inventory assertions across these categories:
 *   - 4 top-level declarations
 *   - 2 nested declarations
 *   - 4 exports
 *   - 3 re-exports
 *   - 3 imports
 *   - 2 type-only imports
 *   - 3 dynamic imports
 *   - 3 JSX usages
 *   - 2 enum + class members
 *   - 2 decorators
 *   - 2 destructuring / computed names
 *
 * Total: 3 structural + 30 fixture = 33 cases.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ASTNode, Program } from '../ast/kinds.js';
import { childrenOf } from '../ast/visit.js';
import { parse } from '../parsers/oxc.js';
import { buildInventory } from '../visitor/index.js';
import type { Inventory } from '../visitor/types.js';
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

async function parseProgram(source: string, lang: 'ts' | 'tsx' = 'ts'): Promise<Program> {
  const filename = lang === 'tsx' ? 'fixture.tsx' : 'fixture.ts';
  const result = await parse(source, { filename, lang });
  expect(result.errors).toEqual([]);
  if (result.program === null) {
    throw new Error('expected non-null program');
  }
  return result.program;
}

function countViaChildrenOf(node: ASTNode): number {
  let count = 1;
  for (const child of childrenOf(node)) {
    count += countViaChildrenOf(child);
  }
  return count;
}

interface ShapeDeclaration {
  readonly kind: string;
  readonly name: string;
  readonly exported: boolean;
  readonly members?: readonly string[];
}

interface ShapeImport {
  readonly kind: string;
  readonly source: string;
  readonly resolvable: boolean;
}

interface ShapeUsage {
  readonly kind: string;
  readonly name: string;
}

function shapeOf(inv: Inventory): {
  declarations: ShapeDeclaration[];
  imports: ShapeImport[];
  usages: ShapeUsage[];
} {
  return {
    declarations: inv.declarations.map((d) => ({
      kind: d.kind,
      name: d.name,
      exported: d.exported,
      members: d.members,
    })),
    imports: inv.imports.map((i) => ({
      kind: i.kind,
      source: i.source,
      resolvable: i.resolvable,
    })),
    usages: inv.usages.map((u) => ({ kind: u.kind, name: u.name })),
  };
}

// ---------------------------------------------------------------------------
// Structural tests
// ---------------------------------------------------------------------------

describe('visitor — structural invariants', () => {
  it('single-pass: onEnter count matches childrenOf recursion count', async () => {
    const fixtures = [
      'function f() { return 1; }',
      'class C { method() {} field = 2; }',
      `import x from './m'; export const v = 1; <div/>;`,
    ];
    for (const src of fixtures) {
      const program = await parseProgram(src, 'tsx');
      const baseline = countViaChildrenOf(program);
      const counter = { count: 0 };
      buildInventory(program, { onEnter: () => void counter.count++ });
      expect(counter.count).toBe(baseline);
    }
  });

  it('no legacy sentinel token in visitor source files', async () => {
    const FORBIDDEN = ['INSTANCE', '_EXPORT_', 'SENTINEL'].join('');
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(here, '..', 'visitor', 'index.ts'),
      resolve(here, '..', 'visitor', 'declarations.ts'),
      resolve(here, '..', 'visitor', 'imports.ts'),
      resolve(here, '..', 'visitor', 'usages.ts'),
      resolve(here, '..', 'visitor', 'types.ts'),
    ];
    for (const path of candidates) {
      const txt = await readFile(path, 'utf8');
      expect(txt).not.toContain(FORBIDDEN);
    }
  });

  it('determinism: byte-equal JSON across repeated builds', async () => {
    const fixtures = [
      `import a from './m'; import('./n'); export const v = 1;`,
      'class C { @dec method() {} } enum E { A, B }',
      `<Foo/>; foo.bar; export { x } from './m';`,
    ];
    for (const src of fixtures) {
      const program = await parseProgram(src, 'tsx');
      const a = buildInventory(program);
      const b = buildInventory(program);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
});

// ---------------------------------------------------------------------------
// 30 source fixtures
// ---------------------------------------------------------------------------

describe('visitor — top-level declarations', () => {
  it('function declaration', async () => {
    const program = await parseProgram('function f() {}');
    const s = shapeOf(buildInventory(program));
    expect(s.declarations).toEqual([{ kind: 'function', name: 'f', exported: false, members: [] }]);
  });

  it('class declaration', async () => {
    const program = await parseProgram('class C {}');
    const s = shapeOf(buildInventory(program));
    expect(s.declarations).toEqual([{ kind: 'class', name: 'C', exported: false, members: [] }]);
  });

  it('const variable declaration', async () => {
    const program = await parseProgram('const x = 1;');
    const s = shapeOf(buildInventory(program));
    expect(s.declarations).toEqual([{ kind: 'variable', name: 'x', exported: false, members: [] }]);
  });

  it('let variable declaration', async () => {
    const program = await parseProgram('let y = 2;');
    const s = shapeOf(buildInventory(program));
    expect(s.declarations).toEqual([{ kind: 'variable', name: 'y', exported: false, members: [] }]);
  });
});

describe('visitor — nested declarations', () => {
  it('function inside function', async () => {
    const program = await parseProgram('function outer() { function inner() {} }');
    const s = shapeOf(buildInventory(program));
    const names = s.declarations.map((d) => d.name).sort();
    expect(names).toEqual(['inner', 'outer']);
    for (const d of s.declarations) {
      expect(d.kind).toBe('function');
      expect(d.exported).toBe(false);
    }
  });

  it('class with method member', async () => {
    const program = await parseProgram('class C { method() {} field = 1; }');
    const s = shapeOf(buildInventory(program));
    expect(s.declarations.length).toBe(1);
    const cls = s.declarations[0];
    expect(cls?.kind).toBe('class');
    expect(cls?.name).toBe('C');
    expect(cls?.members).toEqual(['method', 'field']);
  });
});

describe('visitor — exports', () => {
  it('named export of const', async () => {
    const program = await parseProgram('export const v = 1;');
    const s = shapeOf(buildInventory(program));
    const declared = s.declarations.find((d) => d.name === 'v');
    expect(declared).toBeDefined();
    expect(declared?.exported).toBe(true);
    expect(declared?.kind).toBe('variable');
  });

  it('export default function (named)', async () => {
    const program = await parseProgram('export default function namedDefault() {}');
    const s = shapeOf(buildInventory(program));
    const fn = s.declarations.find((d) => d.kind === 'function');
    expect(fn).toBeDefined();
    expect(fn?.exported).toBe(true);
    expect(fn?.name).toBe('namedDefault');
  });

  it('export default expression (anonymous)', async () => {
    const program = await parseProgram('export default 42;');
    const s = shapeOf(buildInventory(program));
    // Anonymous default expression has no declared symbol — just the export.
    expect(s.declarations.every((d) => d.exported === false || d.name !== '')).toBe(true);
  });

  it('named export function', async () => {
    const program = await parseProgram('export function helper() {}');
    const s = shapeOf(buildInventory(program));
    const fn = s.declarations.find((d) => d.name === 'helper');
    expect(fn).toBeDefined();
    expect(fn?.exported).toBe(true);
    expect(fn?.kind).toBe('function');
  });
});

describe('visitor — re-exports', () => {
  it(`export { x } from './m'`, async () => {
    const program = await parseProgram(`export { x } from './m';`);
    const s = shapeOf(buildInventory(program));
    expect(s.imports).toEqual([{ kind: 'reexport', source: './m', resolvable: true }]);
  });

  it(`export * from './m'`, async () => {
    const program = await parseProgram(`export * from './m';`);
    const s = shapeOf(buildInventory(program));
    expect(s.imports).toEqual([{ kind: 'reexport', source: './m', resolvable: true }]);
  });

  it(`export { y as z } from './m'`, async () => {
    const program = await parseProgram(`export { y as z } from './m';`);
    const s = shapeOf(buildInventory(program));
    expect(s.imports).toEqual([{ kind: 'reexport', source: './m', resolvable: true }]);
  });
});

describe('visitor — imports', () => {
  it('default import', async () => {
    const program = await parseProgram(`import foo from './m';`);
    const s = shapeOf(buildInventory(program));
    expect(s.imports).toEqual([{ kind: 'static', source: './m', resolvable: true }]);
  });

  it('named import', async () => {
    const program = await parseProgram(`import { a, b } from './m';`);
    const s = shapeOf(buildInventory(program));
    expect(s.imports).toEqual([{ kind: 'static', source: './m', resolvable: true }]);
  });

  it('namespace import', async () => {
    const program = await parseProgram(`import * as ns from './m';`);
    const s = shapeOf(buildInventory(program));
    expect(s.imports).toEqual([{ kind: 'static', source: './m', resolvable: true }]);
  });
});

describe('visitor — type-only imports', () => {
  it(`import type { X } from './m'`, async () => {
    const program = await parseProgram(`import type { X } from './m';`);
    const s = shapeOf(buildInventory(program));
    expect(s.imports).toEqual([{ kind: 'static', source: './m', resolvable: true }]);
  });

  it(`import { type Y } from './m'`, async () => {
    const program = await parseProgram(`import { type Y } from './m';`);
    const s = shapeOf(buildInventory(program));
    expect(s.imports).toEqual([{ kind: 'static', source: './m', resolvable: true }]);
  });
});

describe('visitor — dynamic imports', () => {
  it(`literal: import('./m')`, async () => {
    const program = await parseProgram(`import('./m');`);
    const s = shapeOf(buildInventory(program));
    expect(s.imports).toEqual([{ kind: 'dynamic', source: './m', resolvable: true }]);
  });

  it('template literal argument is non-resolvable', async () => {
    const program = await parseProgram('import(`./${x}`);');
    const s = shapeOf(buildInventory(program));
    expect(s.imports).toEqual([{ kind: 'dynamic', source: '', resolvable: false }]);
  });

  it('variable argument is non-resolvable', async () => {
    const program = await parseProgram('import(specifier);');
    const s = shapeOf(buildInventory(program));
    expect(s.imports).toEqual([{ kind: 'dynamic', source: '', resolvable: false }]);
  });
});

describe('visitor — JSX usages', () => {
  it('lowercase tag <div/>', async () => {
    const program = await parseProgram('<div/>;', 'tsx');
    const s = shapeOf(buildInventory(program));
    const jsx = s.usages.filter((u) => u.kind === 'jsx');
    expect(jsx).toEqual([{ kind: 'jsx', name: 'div' }]);
  });

  it('component <Foo/>', async () => {
    const program = await parseProgram('<Foo/>;', 'tsx');
    const s = shapeOf(buildInventory(program));
    const jsx = s.usages.filter((u) => u.kind === 'jsx');
    expect(jsx).toEqual([{ kind: 'jsx', name: 'Foo' }]);
  });

  it('member-form <Foo.Bar/> collapses to empty name', async () => {
    const program = await parseProgram('<Foo.Bar/>;', 'tsx');
    const s = shapeOf(buildInventory(program));
    const jsx = s.usages.filter((u) => u.kind === 'jsx');
    expect(jsx).toEqual([{ kind: 'jsx', name: '' }]);
  });
});

describe('visitor — enum and class members', () => {
  it('enum members listed in declaration order', async () => {
    const program = await parseProgram('enum Color { Red, Green }');
    const s = shapeOf(buildInventory(program));
    const en = s.declarations.find((d) => d.kind === 'enum');
    expect(en).toBeDefined();
    expect(en?.name).toBe('Color');
    expect(en?.members).toEqual(['Red', 'Green']);
  });

  it('class members include methods and fields', async () => {
    const program = await parseProgram('class C { method() {} field = 1; }');
    const s = shapeOf(buildInventory(program));
    const cls = s.declarations.find((d) => d.kind === 'class');
    expect(cls?.members).toEqual(['method', 'field']);
  });
});

describe('visitor — decorators', () => {
  it('@dec class C {}', async () => {
    const program = await parseProgram('@dec class C {}');
    const s = shapeOf(buildInventory(program));
    const decorators = s.usages.filter((u) => u.kind === 'decorator');
    expect(decorators).toEqual([{ kind: 'decorator', name: 'dec' }]);
  });

  it('@dec() class C {}', async () => {
    const program = await parseProgram('@dec() class C {}');
    const s = shapeOf(buildInventory(program));
    const decorators = s.usages.filter((u) => u.kind === 'decorator');
    expect(decorators).toEqual([{ kind: 'decorator', name: 'dec' }]);
  });
});

describe('visitor — destructuring + computed names (no crash)', () => {
  it('destructuring: const { a, b } = obj', async () => {
    const program = await parseProgram('const { a, b } = obj;');
    expect(() => buildInventory(program)).not.toThrow();
  });

  it('computed property: class C { [x]() {} }', async () => {
    const program = await parseProgram('class C { [x]() {} }');
    expect(() => buildInventory(program)).not.toThrow();
  });
});
