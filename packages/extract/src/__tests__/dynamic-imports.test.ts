/**
 * dynamic-imports.test.ts — Phase 3c.4 Dispatch C-1 (T066) acceptance suite.
 *
 * 14 source-fixture cases covering:
 *
 *   - 4 dynamic `import()` literal forms (verbatim resolvable string)
 *   - 3 dynamic `import()` template forms
 *       (constant-prefix template, leading-expression template, no-expression
 *        template-equivalent-to-literal)
 *   - 3 dynamic `import()` non-resolvable forms (Identifier, CallExpression,
 *     binary expression collapsed to UnknownExpression)
 *   - 4 asset-URL forms — `new URL(literal, import.meta.url)` patterns
 *
 * Plus one determinism test that builds the inventory twice and compares
 * `JSON.stringify`. Range-equality is covered there; per-fixture assertions
 * inspect only `kind` / `source` / `resolvable`.
 *
 * Walker workaround applied:
 *   - SWC `AwaitExpression` and `YieldExpression` now pass-through to the
 *     inner argument's classification (added to `parsers/oxc.ts`
 *     `classifyExpression`). This lets `await import('./x')` reach its
 *     inner `CallExpression` via the walker. Without the pass-through, the
 *     await wrapper collapsed to UnknownExpression and the walker could not
 *     descend.
 *
 * Known limitation (NOT exercised by these fixtures): asset-URL constructors
 * inside variable initializers (`const u = new URL(...)`) are NOT reached
 * because the walker does not currently descend into VariableDecl declarators.
 * Each asset-URL fixture is framed as a top-level expression statement.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Program } from '../ast/kinds.js';
import { parse } from '../parsers/oxc.js';
import { buildInventory } from '../visitor/index.js';
import type { Import } from '../visitor/types.js';
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

interface ImportShape {
  readonly kind: Import['kind'];
  readonly source: string;
  readonly resolvable: boolean;
}

function shapeImports(program: Program): ImportShape[] {
  const inv = buildInventory(program);
  return inv.imports.map((i) => ({
    kind: i.kind,
    source: i.source,
    resolvable: i.resolvable,
  }));
}

// ---------------------------------------------------------------------------
// Dynamic `import()` — string literal
// ---------------------------------------------------------------------------

describe('dynamic imports — literal argument', () => {
  it(`single-quoted: import('./a')`, async () => {
    const program = await parseProgram(`import('./a');`);
    expect(shapeImports(program)).toEqual([{ kind: 'dynamic', source: './a', resolvable: true }]);
  });

  it(`double-quoted: import("./b")`, async () => {
    const program = await parseProgram(`import("./b");`);
    expect(shapeImports(program)).toEqual([{ kind: 'dynamic', source: './b', resolvable: true }]);
  });

  it(`await-wrapped: await import('./c') (relies on AwaitExpression pass-through)`, async () => {
    // The pass-through in parsers/oxc.ts classifyExpression unwraps the
    // AwaitExpression to its inner argument's classification, so the walker
    // can reach the dynamic-import CallExpression that follows.
    const program = await parseProgram(`async function f() { await import('./c'); }`);
    expect(shapeImports(program)).toEqual([{ kind: 'dynamic', source: './c', resolvable: true }]);
  });

  it(`extension-bearing literal: import('./d.js')`, async () => {
    const program = await parseProgram(`import('./d.js');`);
    expect(shapeImports(program)).toEqual([
      { kind: 'dynamic', source: './d.js', resolvable: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Dynamic `import()` — TemplateLiteral
// ---------------------------------------------------------------------------

describe('dynamic imports — template-literal argument', () => {
  it('constant-prefix template: import(`./mod-${name}`)', async () => {
    // Constant prefix './mod-' surfaces on the Import record, even though
    // the full source remains unresolvable.
    const program = await parseProgram('import(`./mod-${name}`);');
    expect(shapeImports(program)).toEqual([
      { kind: 'dynamic', source: './mod-', resolvable: false },
    ]);
  });

  it('leading-expression template: import(`${prefix}/x`) (empty prefix)', async () => {
    const program = await parseProgram('import(`${prefix}/x`);');
    expect(shapeImports(program)).toEqual([{ kind: 'dynamic', source: '', resolvable: false }]);
  });

  it('no-expression template: import(`./static`) (literal-equivalent)', async () => {
    // A template with zero interpolation slots is structurally equivalent to
    // a string literal and surfaces as resolvable.
    const program = await parseProgram('import(`./static`);');
    expect(shapeImports(program)).toEqual([
      { kind: 'dynamic', source: './static', resolvable: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Dynamic `import()` — non-resolvable
// ---------------------------------------------------------------------------

describe('dynamic imports — non-resolvable argument', () => {
  it('bare identifier: import(specifier)', async () => {
    const program = await parseProgram('import(specifier);');
    expect(shapeImports(program)).toEqual([{ kind: 'dynamic', source: '', resolvable: false }]);
  });

  it('call-expression argument: import(getPath())', async () => {
    const program = await parseProgram('import(getPath());');
    expect(shapeImports(program)).toEqual([{ kind: 'dynamic', source: '', resolvable: false }]);
  });

  it('binary expression collapses to UnknownExpression: import(1 + 1)', async () => {
    const program = await parseProgram('import(1 + 1);');
    expect(shapeImports(program)).toEqual([{ kind: 'dynamic', source: '', resolvable: false }]);
  });
});

// ---------------------------------------------------------------------------
// Asset-URL — `new URL(literal, import.meta.url)`
// ---------------------------------------------------------------------------

describe('asset URLs — new URL(literal, import.meta.url)', () => {
  it(`single-quoted asset: new URL('./img.png', import.meta.url)`, async () => {
    const program = await parseProgram(`new URL('./img.png', import.meta.url);`);
    expect(shapeImports(program)).toEqual([
      { kind: 'asset', source: './img.png', resolvable: true },
    ]);
  });

  it(`double-quoted asset: new URL("./styles.css", import.meta.url)`, async () => {
    const program = await parseProgram(`new URL("./styles.css", import.meta.url);`);
    expect(shapeImports(program)).toEqual([
      { kind: 'asset', source: './styles.css', resolvable: true },
    ]);
  });

  it('two asset edges in one source emit two records in declaration order', async () => {
    const program = await parseProgram(
      `new URL('./a.svg', import.meta.url); new URL('./b.svg', import.meta.url);`,
    );
    expect(shapeImports(program)).toEqual([
      { kind: 'asset', source: './a.svg', resolvable: true },
      { kind: 'asset', source: './b.svg', resolvable: true },
    ]);
  });

  it('non-matching shapes do NOT produce asset edges', async () => {
    // Each of these is structurally close to the asset pattern but rejected
    // by `matchAssetUrl`'s strict checks: wrong constructor name, non-string
    // first arg, wrong second arg, missing second arg.
    const program = await parseProgram(`
      new URL(href, import.meta.url);
      new URL('./x', someBase);
      new URL('./x');
      new URLSearchParams('./x', import.meta.url);
    `);
    const imports = shapeImports(program);
    const assetImports = imports.filter((i) => i.kind === 'asset');
    expect(assetImports).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('dynamic + asset imports — determinism', () => {
  it('byte-equal JSON across repeated buildInventory calls', async () => {
    const fixtures = [
      `import('./a'); import(\`./mod-\${x}\`); import(specifier);`,
      `new URL('./img.png', import.meta.url); new URL('./b.svg', import.meta.url);`,
      `async function f() { await import('./c'); } import(\`./static\`);`,
    ];
    for (const src of fixtures) {
      const program = await parseProgram(src);
      const a = buildInventory(program);
      const b = buildInventory(program);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
});
