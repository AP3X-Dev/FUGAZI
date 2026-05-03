/**
 * build-graph.test.ts — Phase 3d.3 (T092) acceptance suite for `buildGraph`.
 *
 * The graph builder is exercised against synthetic in-memory `FileNode` sets
 * with handcrafted `Inventory` records. This avoids pulling the @fugazi/extract
 * WASM machinery into the graph test surface — the inventory shape is small
 * and stable enough to construct directly. Each fixture pairs a memory
 * `FsAdapter` with a `ResolverContext` so resolution flows through the real
 * Phase 3d.2 dispatcher.
 *
 * Ten fixtures (matching the dispatch brief):
 *   1. linear chain A → B → C → D → E
 *   2. branching A → B, A → C, B → D, C → D
 *   3. diamond A → B → D, A → C → D
 *   4. multiple entry points: A and B both import C
 *   5. isolated subgraphs A→B and X→Y
 *   6. self-import A → A
 *   7. mutual cycle A → B → A
 *   8. unresolved import → ROOT_FILE_ID, resolvable: false
 *   9. external (node_modules absent) → ROOT_FILE_ID, resolvable: false
 *  10. determinism: byte-equal JSON.stringify across two runs
 */

import type { Import, Inventory } from '@fugazi/extract';
import { type FileId, ROOT_FILE_ID, type Range, assignFileIds } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../build.js';
import { createMemoryFsAdapter } from '../resolve/fs-adapter.js';
import type { ResolverContext } from '../resolve/index.js';
import type { FileNode } from '../types.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const ZERO_RANGE: Range = {
  start: { line: 1, column: 0, byteOffset: 0 },
  end: { line: 1, column: 1, byteOffset: 1 },
};

function inventoryWithImports(imports: readonly Import[]): Inventory {
  return {
    declarations: [],
    imports,
    usages: [],
  };
}

interface FileSpec {
  readonly path: string;
  readonly imports: readonly string[];
  /** Parallel array of import kinds; defaults to 'static' for each entry. */
  readonly kinds?: readonly Import['kind'][];
  /** Parallel array of `resolvable` flags (defaults to true). */
  readonly resolvableFlags?: readonly boolean[];
}

/**
 * Build a `FileNode[]` for the given specs. `assignFileIds` produces the
 * canonical path-sorted FileId mapping; the input order is preserved here so
 * downstream `buildGraph` walks files in path-sorted order.
 */
function makeFileNodes(specs: readonly FileSpec[]): readonly FileNode[] {
  const ids = assignFileIds(specs.map((s) => s.path));
  const sorted = [...specs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sorted.map((spec) => {
    const id = ids.get(spec.path);
    if (id === undefined) {
      throw new Error(`assignFileIds did not yield an id for ${spec.path}`);
    }
    const imports = spec.imports.map((src, i) => {
      const kind = spec.kinds?.[i] ?? 'static';
      const resolvable = spec.resolvableFlags?.[i] ?? true;
      return { kind, source: src, resolvable, range: ZERO_RANGE } satisfies Import;
    });
    return {
      id,
      path: spec.path,
      inventory: inventoryWithImports(imports),
    } satisfies FileNode;
  });
}

function memoryFsForFiles(specs: readonly FileSpec[]): ReturnType<typeof createMemoryFsAdapter> {
  const record: Record<string, string> = {};
  for (const spec of specs) {
    record[spec.path] = '';
  }
  return createMemoryFsAdapter(record);
}

function ctxFor(specs: readonly FileSpec[], extra?: Record<string, string>): ResolverContext {
  const record: Record<string, string> = {};
  for (const spec of specs) {
    record[spec.path] = '';
  }
  if (extra !== undefined) {
    for (const [k, v] of Object.entries(extra)) {
      record[k] = v;
    }
  }
  return { projectRoot: '/proj', fs: createMemoryFsAdapter(record) };
}

function findEdge(
  graph: ReturnType<typeof buildGraph>,
  from: FileId,
  to: FileId,
  specifier: string,
) {
  return graph.edges.find((e) => e.from === from && e.to === to && e.specifier === specifier);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe('buildGraph', () => {
  it('linear chain A → B → C → D → E', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: ['./b'] },
      { path: '/proj/b.ts', imports: ['./c'] },
      { path: '/proj/c.ts', imports: ['./d'] },
      { path: '/proj/d.ts', imports: ['./e'] },
      { path: '/proj/e.ts', imports: [] },
    ];
    const files = makeFileNodes(specs);
    const ctx: ResolverContext = { projectRoot: '/proj', fs: memoryFsForFiles(specs) };
    const graph = buildGraph({ files, resolverContext: ctx });
    expect(graph.edges.length).toBe(4);
    // Every edge should be resolvable and chained.
    const allResolvable = graph.edges.every((e) => e.resolvable);
    expect(allResolvable).toBe(true);
    // a → b
    const idA = files[0]?.id as FileId;
    const idB = files[1]?.id as FileId;
    expect(findEdge(graph, idA, idB, './b')).toBeDefined();
  });

  it('branching: A imports B and C, both import D', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: ['./b', './c'] },
      { path: '/proj/b.ts', imports: ['./d'] },
      { path: '/proj/c.ts', imports: ['./d'] },
      { path: '/proj/d.ts', imports: [] },
    ];
    const files = makeFileNodes(specs);
    const ctx = ctxFor(specs);
    const graph = buildGraph({ files, resolverContext: ctx });
    expect(graph.edges.length).toBe(4);
    const idD = files.find((f) => f.path === '/proj/d.ts')?.id as FileId;
    const incoming = graph.edgesByTarget.get(idD);
    expect(incoming?.length).toBe(2);
  });

  it('diamond: A → B → D, A → C → D', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: ['./b', './c'] },
      { path: '/proj/b.ts', imports: ['./d'] },
      { path: '/proj/c.ts', imports: ['./d'] },
      { path: '/proj/d.ts', imports: [] },
    ];
    const files = makeFileNodes(specs);
    const ctx = ctxFor(specs);
    const graph = buildGraph({ files, resolverContext: ctx });
    const idD = files.find((f) => f.path === '/proj/d.ts')?.id as FileId;
    const inD = graph.edgesByTarget.get(idD);
    expect(inD?.length).toBe(2);
    expect(inD?.every((e) => e.specifier === './d')).toBe(true);
  });

  it('multiple entry points: A and B both import C', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: ['./c'] },
      { path: '/proj/b.ts', imports: ['./c'] },
      { path: '/proj/c.ts', imports: [] },
    ];
    const files = makeFileNodes(specs);
    const ctx = ctxFor(specs);
    const graph = buildGraph({ files, resolverContext: ctx });
    const idC = files.find((f) => f.path === '/proj/c.ts')?.id as FileId;
    expect(graph.edgesByTarget.get(idC)?.length).toBe(2);
  });

  it('isolated subgraphs: A → B; X → Y', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: ['./b'] },
      { path: '/proj/b.ts', imports: [] },
      { path: '/proj/x.ts', imports: ['./y'] },
      { path: '/proj/y.ts', imports: [] },
    ];
    const files = makeFileNodes(specs);
    const ctx = ctxFor(specs);
    const graph = buildGraph({ files, resolverContext: ctx });
    expect(graph.edges.length).toBe(2);
    // A's bucket and X's bucket are disjoint — no edge between them.
    const idA = files.find((f) => f.path === '/proj/a.ts')?.id as FileId;
    const idY = files.find((f) => f.path === '/proj/y.ts')?.id as FileId;
    const aToY = graph.edges.find((e) => e.from === idA && e.to === idY);
    expect(aToY).toBeUndefined();
  });

  it('self-import: A → A', () => {
    const specs: FileSpec[] = [{ path: '/proj/a.ts', imports: ['./a'] }];
    const files = makeFileNodes(specs);
    const ctx = ctxFor(specs);
    const graph = buildGraph({ files, resolverContext: ctx });
    expect(graph.edges.length).toBe(1);
    const idA = files[0]?.id as FileId;
    const e = graph.edges[0];
    expect(e?.from).toBe(idA);
    expect(e?.to).toBe(idA);
    expect(e?.resolvable).toBe(true);
  });

  it('mutual cycle: A → B → A', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: ['./b'] },
      { path: '/proj/b.ts', imports: ['./a'] },
    ];
    const files = makeFileNodes(specs);
    const ctx = ctxFor(specs);
    const graph = buildGraph({ files, resolverContext: ctx });
    expect(graph.edges.length).toBe(2);
    const idA = files.find((f) => f.path === '/proj/a.ts')?.id as FileId;
    const idB = files.find((f) => f.path === '/proj/b.ts')?.id as FileId;
    expect(findEdge(graph, idA, idB, './b')).toBeDefined();
    expect(findEdge(graph, idB, idA, './a')).toBeDefined();
  });

  it('unresolved import collapses to ROOT_FILE_ID with resolvable=false', () => {
    const specs: FileSpec[] = [{ path: '/proj/a.ts', imports: ['./missing'] }];
    const files = makeFileNodes(specs);
    const ctx = ctxFor(specs);
    const graph = buildGraph({ files, resolverContext: ctx });
    expect(graph.edges.length).toBe(1);
    const e = graph.edges[0];
    expect(e?.to).toBe(ROOT_FILE_ID);
    expect(e?.resolvable).toBe(false);
    expect(e?.specifier).toBe('./missing');
  });

  it('external (node_modules absent) → ROOT_FILE_ID with resolvable=false', () => {
    const specs: FileSpec[] = [{ path: '/proj/a.ts', imports: ['react'] }];
    const files = makeFileNodes(specs);
    const ctx = ctxFor(specs);
    const graph = buildGraph({ files, resolverContext: ctx });
    expect(graph.edges.length).toBe(1);
    const e = graph.edges[0];
    expect(e?.to).toBe(ROOT_FILE_ID);
    expect(e?.resolvable).toBe(false);
    expect(e?.specifier).toBe('react');
  });

  it('node: builtin → ROOT_FILE_ID with resolvable=true (no false-positive)', () => {
    const specs: FileSpec[] = [{ path: '/proj/a.ts', imports: ['node:fs'] }];
    const files = makeFileNodes(specs);
    const ctx = ctxFor(specs);
    const graph = buildGraph({ files, resolverContext: ctx });
    expect(graph.edges.length).toBe(1);
    const e = graph.edges[0];
    expect(e?.to).toBe(ROOT_FILE_ID);
    expect(e?.resolvable).toBe(true);
    expect(e?.specifier).toBe('node:fs');
  });

  it('bun: builtin → ROOT_FILE_ID with resolvable=true', () => {
    const specs: FileSpec[] = [{ path: '/proj/a.ts', imports: ['bun:test'] }];
    const files = makeFileNodes(specs);
    const ctx = ctxFor(specs);
    const graph = buildGraph({ files, resolverContext: ctx });
    expect(graph.edges.length).toBe(1);
    const e = graph.edges[0];
    expect(e?.to).toBe(ROOT_FILE_ID);
    expect(e?.resolvable).toBe(true);
    expect(e?.specifier).toBe('bun:test');
  });

  it('resolved on-disk but outside project file set → resolvable=true (third-party)', () => {
    // `vendor` resolves to a real file under `/vendor/` which is NOT in the
    // project file set. Pre-fix this surfaced as `resolvable: false` and the
    // import-hygiene rule false-positived. New behaviour: the specifier did
    // resolve on disk so the edge is `resolvable: true`, just bucketed under
    // ROOT_FILE_ID because we have no FileId for the out-of-project file.
    const specs: FileSpec[] = [{ path: '/proj/a.ts', imports: ['./vendor/dep.js'] }];
    const files = makeFileNodes(specs);
    const ctx = ctxFor(specs, { '/proj/vendor/dep.js': '' });
    // Drop the vendor file from the project file set deliberately by NOT
    // listing it in `specs`. The fs adapter still has it.
    const graph = buildGraph({ files, resolverContext: ctx });
    expect(graph.edges.length).toBe(1);
    const e = graph.edges[0];
    expect(e?.to).toBe(ROOT_FILE_ID);
    expect(e?.resolvable).toBe(true);
  });

  it('determinism: same input produces byte-equal JSON.stringify(graph)', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: ['./b', './c'] },
      { path: '/proj/b.ts', imports: ['./d'] },
      { path: '/proj/c.ts', imports: ['./d'] },
      { path: '/proj/d.ts', imports: [] },
    ];
    const files = makeFileNodes(specs);
    // Re-uses the same memory adapter and resolver context across both runs
    // so we exercise the resolver/edge-sort path twice from a clean state.
    const ctxA: ResolverContext = { projectRoot: '/proj', fs: memoryFsForFiles(specs) };
    const ctxB: ResolverContext = { projectRoot: '/proj', fs: memoryFsForFiles(specs) };
    const a = buildGraph({ files, resolverContext: ctxA });
    const b = buildGraph({ files, resolverContext: ctxB });
    // JSON.stringify of a Map iterates [].entries(), so we serialise an
    // exhaustive shape that captures edge order + per-target sub-order.
    const shape = (g: ReturnType<typeof buildGraph>) => ({
      edges: g.edges,
      byTarget: [...g.edgesByTarget.entries()],
      files: [...g.files.entries()].map(([id, n]) => ({ id, path: n.path })),
    });
    expect(JSON.stringify(shape(a))).toBe(JSON.stringify(shape(b)));
  });

  it('edges sorted by (from, to, kind, specifier)', () => {
    // Use mixed kinds to verify the secondary sort keys actually apply.
    const specs: FileSpec[] = [
      {
        path: '/proj/a.ts',
        imports: ['./c', './b', './b'],
        kinds: ['static', 'type', 'static'],
      },
      { path: '/proj/b.ts', imports: [] },
      { path: '/proj/c.ts', imports: [] },
    ];
    const files = makeFileNodes(specs);
    const ctx = ctxFor(specs);
    const graph = buildGraph({ files, resolverContext: ctx });
    // For `from=A`, B has the smaller FileId (lex-sorted), so edges →B come
    // before edges →C. Within →B, kind 'static' < 'type'.
    const idA = files.find((f) => f.path === '/proj/a.ts')?.id as FileId;
    const fromA = graph.edges.filter((e) => e.from === idA);
    expect(fromA.length).toBe(3);
    // Each consecutive pair must be in canonical order.
    for (let i = 1; i < fromA.length; i++) {
      const prev = fromA[i - 1];
      const cur = fromA[i];
      if (prev === undefined || cur === undefined) continue;
      const ok =
        prev.to < cur.to ||
        (prev.to === cur.to && prev.kind <= cur.kind) ||
        (prev.to === cur.to && prev.kind === cur.kind && prev.specifier <= cur.specifier);
      expect(ok).toBe(true);
    }
  });

  it('non-resolvable Import (visitor flag false) collapses to ROOT_FILE_ID', () => {
    // Mimics a dynamic-import template-literal argument: the visitor flagged
    // it `resolvable: false` upstream, so the graph builder must not attempt
    // to call `resolve()`.
    const specs: FileSpec[] = [
      {
        path: '/proj/a.ts',
        imports: ['./'],
        kinds: ['dynamic'],
        resolvableFlags: [false],
      },
    ];
    const files = makeFileNodes(specs);
    const ctx = ctxFor(specs);
    const graph = buildGraph({ files, resolverContext: ctx });
    expect(graph.edges.length).toBe(1);
    const e = graph.edges[0];
    expect(e?.to).toBe(ROOT_FILE_ID);
    expect(e?.resolvable).toBe(false);
    expect(e?.kind).toBe('dynamic');
  });

  it('reverse index `edgesByTarget` lists files in numeric to-id order', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: ['./d', './b'] },
      { path: '/proj/b.ts', imports: [] },
      { path: '/proj/c.ts', imports: ['./d'] },
      { path: '/proj/d.ts', imports: [] },
    ];
    const files = makeFileNodes(specs);
    const ctx = ctxFor(specs);
    const graph = buildGraph({ files, resolverContext: ctx });
    const targets = [...graph.edgesByTarget.keys()];
    // Targets should be ascending FileIds.
    for (let i = 1; i < targets.length; i++) {
      const prev = targets[i - 1];
      const cur = targets[i];
      if (prev === undefined || cur === undefined) continue;
      expect((prev as number) <= (cur as number)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 4f T381 — Python submodule promotion + package-init edges
// ---------------------------------------------------------------------------

/**
 * Build a Python-flavored FileNode set. Each node carries lang: 'py' on its
 * inventory and a single import statement encoded with optional `names`. The
 * imported file paths are auto-registered in the memory fs adapter so the
 * resolver finds them.
 */
function makePyFileNodes(
  specs: readonly {
    path: string;
    source?: string;
    names?: readonly string[];
  }[],
): readonly FileNode[] {
  const ids = assignFileIds(specs.map((s) => s.path));
  const sorted = [...specs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sorted.map((spec) => {
    const id = ids.get(spec.path);
    if (id === undefined) throw new Error(`no id for ${spec.path}`);
    const imports: Import[] =
      spec.source === undefined
        ? []
        : [
            {
              kind: 'static',
              source: spec.source,
              resolvable: true,
              range: ZERO_RANGE,
              ...(spec.names !== undefined ? { names: spec.names } : {}),
            },
          ];
    return {
      id,
      path: spec.path,
      inventory: {
        lang: 'py' as const,
        declarations: [],
        imports,
        usages: [],
      },
    } satisfies FileNode;
  });
}

describe('buildGraph — Python submodule promotion (T381 Bug 1)', () => {
  it('from .sub import foo emits BOTH the package-init edge AND the submodule edge', () => {
    const specs = [
      { path: '/proj/pkg/__init__.py' },
      { path: '/proj/pkg/sub/__init__.py' },
      { path: '/proj/pkg/sub/foo.py' },
      // main.py does `from .sub import foo`
      { path: '/proj/pkg/main.py', source: '.sub', names: ['foo'] },
    ];
    const files = makePyFileNodes(specs);
    const fs = createMemoryFsAdapter(Object.fromEntries(specs.map((s) => [s.path, ''] as const)));
    const graph = buildGraph({
      files,
      resolverContext: { projectRoot: '/proj', fs },
    });
    const mainId = files.find((f) => f.path === '/proj/pkg/main.py')?.id;
    const subInitId = files.find((f) => f.path === '/proj/pkg/sub/__init__.py')?.id;
    const fooId = files.find((f) => f.path === '/proj/pkg/sub/foo.py')?.id;
    expect(mainId).toBeDefined();
    expect(subInitId).toBeDefined();
    expect(fooId).toBeDefined();
    if (mainId === undefined || subInitId === undefined || fooId === undefined) return;
    // Primary edge: main.py → sub/__init__.py (specifier `.sub`)
    const primary = findEdge(graph, mainId, subInitId, '.sub');
    expect(primary).toBeDefined();
    expect(primary?.resolvable).toBe(true);
    // Submodule promotion edge: main.py → sub/foo.py (specifier `.sub.foo`)
    const submodule = findEdge(graph, mainId, fooId, '.sub.foo');
    expect(submodule).toBeDefined();
    expect(submodule?.resolvable).toBe(true);
  });

  it('symbol-only imports (where <source>.<name> is NOT a file) emit no extra edge', () => {
    const specs = [
      { path: '/proj/pkg/__init__.py' },
      { path: '/proj/pkg/util.py' },
      // `from .util import HELPER` where HELPER is a name in util.py, not a file.
      { path: '/proj/pkg/main.py', source: '.util', names: ['HELPER'] },
    ];
    const files = makePyFileNodes(specs);
    const fs = createMemoryFsAdapter(Object.fromEntries(specs.map((s) => [s.path, ''] as const)));
    const graph = buildGraph({
      files,
      resolverContext: { projectRoot: '/proj', fs },
    });
    const mainId = files.find((f) => f.path === '/proj/pkg/main.py')?.id;
    if (mainId === undefined) return;
    // Only one explicit-import edge from main.py (specifier `.util`).
    const explicitFromMain = graph.edges.filter(
      (e) => e.from === mainId && e.specifier !== '<package-init>',
    );
    expect(explicitFromMain.length).toBe(1);
    expect(explicitFromMain[0]?.specifier).toBe('.util');
  });

  it('multiple names: each that resolves yields its own submodule edge', () => {
    const specs = [
      { path: '/proj/pkg/__init__.py' },
      { path: '/proj/pkg/sub/__init__.py' },
      { path: '/proj/pkg/sub/a.py' },
      { path: '/proj/pkg/sub/b.py' },
      // `from .sub import a, b, MISSING` — a + b promote, MISSING does not.
      { path: '/proj/pkg/main.py', source: '.sub', names: ['a', 'b', 'MISSING'] },
    ];
    const files = makePyFileNodes(specs);
    const fs = createMemoryFsAdapter(Object.fromEntries(specs.map((s) => [s.path, ''] as const)));
    const graph = buildGraph({
      files,
      resolverContext: { projectRoot: '/proj', fs },
    });
    const mainId = files.find((f) => f.path === '/proj/pkg/main.py')?.id;
    if (mainId === undefined) return;
    const fromMain = graph.edges.filter(
      (e) => e.from === mainId && e.specifier !== '<package-init>',
    );
    const specifiers = new Set(fromMain.map((e) => e.specifier));
    expect(specifiers.has('.sub')).toBe(true);
    expect(specifiers.has('.sub.a')).toBe(true);
    expect(specifiers.has('.sub.b')).toBe(true);
    expect(specifiers.has('.sub.MISSING')).toBe(false);
  });

  it('package-init traversal: every Python file emits an edge to its parent __init__.py', () => {
    const specs = [
      { path: '/proj/pkg/__init__.py' },
      { path: '/proj/pkg/sub/__init__.py' },
      { path: '/proj/pkg/sub/foo.py' },
    ];
    const files = makePyFileNodes(specs);
    const fs = createMemoryFsAdapter(Object.fromEntries(specs.map((s) => [s.path, ''] as const)));
    const graph = buildGraph({
      files,
      resolverContext: { projectRoot: '/proj', fs },
    });
    const fooId = files.find((f) => f.path === '/proj/pkg/sub/foo.py')?.id;
    const subInitId = files.find((f) => f.path === '/proj/pkg/sub/__init__.py')?.id;
    const pkgInitId = files.find((f) => f.path === '/proj/pkg/__init__.py')?.id;
    if (fooId === undefined || subInitId === undefined || pkgInitId === undefined) return;
    // foo.py → sub/__init__.py (parent package)
    const fooToSubInit = findEdge(graph, fooId, subInitId, '<package-init>');
    expect(fooToSubInit).toBeDefined();
    // foo.py → pkg/__init__.py (grandparent package)
    const fooToPkgInit = findEdge(graph, fooId, pkgInitId, '<package-init>');
    expect(fooToPkgInit).toBeDefined();
  });

  it('package-init traversal stops at the first directory missing __init__.py', () => {
    const specs = [
      { path: '/proj/src/pkg/__init__.py' },
      { path: '/proj/src/pkg/foo.py' },
      // No /proj/src/__init__.py — chain breaks at /proj/src.
    ];
    const files = makePyFileNodes(specs);
    const fs = createMemoryFsAdapter(Object.fromEntries(specs.map((s) => [s.path, ''] as const)));
    const graph = buildGraph({
      files,
      resolverContext: { projectRoot: '/proj', fs },
    });
    const fooId = files.find((f) => f.path === '/proj/src/pkg/foo.py')?.id;
    if (fooId === undefined) return;
    const initEdges = graph.edges.filter(
      (e) => e.from === fooId && e.specifier === '<package-init>',
    );
    // Only the immediate-parent edge (pkg/__init__.py) is emitted.
    expect(initEdges.length).toBe(1);
  });

  it('TS files do NOT emit package-init synthetic edges', () => {
    const specs: FileSpec[] = [
      { path: '/proj/src/index.ts', imports: ['./util'] },
      { path: '/proj/src/util.ts', imports: [] },
    ];
    const files = makeFileNodes(specs);
    const fs = memoryFsForFiles(specs);
    const graph = buildGraph({
      files,
      resolverContext: { projectRoot: '/proj', fs },
    });
    const synthetic = graph.edges.filter((e) => e.specifier === '<package-init>');
    expect(synthetic.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 4f T381 — Python external-resolution becomes resolvable: true
// ---------------------------------------------------------------------------

describe('buildGraph — Python external imports mark resolvable: true (T381 Bug 2)', () => {
  it('flask import declared in pythonManifest produces an edge with resolvable: true', () => {
    const specs = [{ path: '/proj/app.py', source: 'flask', names: ['Flask'] }];
    const files = makePyFileNodes(specs);
    const fs = createMemoryFsAdapter(Object.fromEntries(specs.map((s) => [s.path, ''] as const)));
    const graph = buildGraph({
      files,
      resolverContext: {
        projectRoot: '/proj',
        fs,
        pythonManifest: {
          runtime: new Set(['flask']),
          dev: new Set(),
          optional: new Set(),
          all: new Set(['flask']),
          source: 'pyproject',
        },
      },
    });
    const appId = files[0]?.id;
    if (appId === undefined) return;
    const edge = graph.edges.find((e) => e.from === appId && e.specifier === 'flask');
    expect(edge).toBeDefined();
    expect(edge?.to).toBe(ROOT_FILE_ID);
    expect(edge?.resolvable).toBe(true); // T381: external Python = resolvable
  });

  it('TS bare-specifier without a node_modules backing stays resolvable: false', () => {
    const specs: FileSpec[] = [{ path: '/proj/src/index.ts', imports: ['unknown-pkg'] }];
    const files = makeFileNodes(specs);
    const fs = memoryFsForFiles(specs);
    const graph = buildGraph({
      files,
      resolverContext: { projectRoot: '/proj', fs },
    });
    const indexId = files[0]?.id;
    if (indexId === undefined) return;
    const edge = graph.edges.find((e) => e.from === indexId && e.specifier === 'unknown-pkg');
    expect(edge).toBeDefined();
    expect(edge?.resolvable).toBe(false);
  });
});
