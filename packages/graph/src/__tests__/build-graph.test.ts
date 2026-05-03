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
