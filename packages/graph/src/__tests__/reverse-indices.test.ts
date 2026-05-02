/**
 * reverse-indices.test.ts — Phase 3d.5 (T103) acceptance suite for
 * `buildReverseIndices`. Mirrors the in-memory FileNode pattern from
 * `build-graph.test.ts` so the resolver runs through the real Phase 3d.2
 * dispatcher without dragging the @fugazi/extract WASM machinery into the
 * graph test surface.
 *
 * The 10 cases below cover the structural shapes most analyses care about:
 * linear, diamond, multi-kind same-target, self-import, empty graph, byte-
 * equal determinism, bucket order, set order, outer-map order, and the
 * ROOT_FILE_ID unresolved bucket. Each test pairs `buildGraph` with
 * `buildReverseIndices` so the helper's contract is tied to a real graph
 * rather than a hand-rolled `Graph` literal.
 */

import type { Import, Inventory } from '@fugazi/extract';
import { type FileId, ROOT_FILE_ID, type Range, assignFileIds } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../build.js';
import { createMemoryFsAdapter } from '../resolve/fs-adapter.js';
import type { ResolverContext } from '../resolve/index.js';
import { buildReverseIndices } from '../reverse-index.js';
import type { FileNode } from '../types.js';

// ---------------------------------------------------------------------------
// Test helpers (same pattern as build-graph.test.ts)
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
  readonly kinds?: readonly Import['kind'][];
  readonly resolvableFlags?: readonly boolean[];
}

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

function ctxFor(specs: readonly FileSpec[]): ResolverContext {
  const record: Record<string, string> = {};
  for (const spec of specs) {
    record[spec.path] = '';
  }
  return { projectRoot: '/proj', fs: createMemoryFsAdapter(record) };
}

function fileIdFor(files: readonly FileNode[], path: string): FileId {
  const node = files.find((f) => f.path === path);
  if (node === undefined) {
    throw new Error(`No FileNode for path ${path}`);
  }
  return node.id;
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe('buildReverseIndices', () => {
  it('linear chain A → B → C: targetsByFile is {A:{B}, B:{C}, C:{}}, edgesByTarget is {B:[A→B], C:[B→C]}', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: ['./b'] },
      { path: '/proj/b.ts', imports: ['./c'] },
      { path: '/proj/c.ts', imports: [] },
    ];
    const files = makeFileNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const idx = buildReverseIndices(graph);

    const idA = fileIdFor(files, '/proj/a.ts');
    const idB = fileIdFor(files, '/proj/b.ts');
    const idC = fileIdFor(files, '/proj/c.ts');

    // targetsByFile: A→{B}, B→{C}; C has no outgoing edges so no entry.
    expect([...(idx.targetsByFile.get(idA) ?? [])]).toEqual([idB]);
    expect([...(idx.targetsByFile.get(idB) ?? [])]).toEqual([idC]);
    expect(idx.targetsByFile.has(idC)).toBe(false);

    // edgesByTarget: B has [A→B], C has [B→C]; A has no incoming edge.
    const inB = idx.edgesByTarget.get(idB);
    const inC = idx.edgesByTarget.get(idC);
    expect(inB?.length).toBe(1);
    expect(inB?.[0]?.from).toBe(idA);
    expect(inC?.length).toBe(1);
    expect(inC?.[0]?.from).toBe(idB);
    expect(idx.edgesByTarget.has(idA)).toBe(false);
  });

  it('diamond A→B, A→C, B→D, C→D: edgesByTarget[D] has both B→D and C→D', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: ['./b', './c'] },
      { path: '/proj/b.ts', imports: ['./d'] },
      { path: '/proj/c.ts', imports: ['./d'] },
      { path: '/proj/d.ts', imports: [] },
    ];
    const files = makeFileNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const idx = buildReverseIndices(graph);

    const idA = fileIdFor(files, '/proj/a.ts');
    const idB = fileIdFor(files, '/proj/b.ts');
    const idC = fileIdFor(files, '/proj/c.ts');
    const idD = fileIdFor(files, '/proj/d.ts');

    expect([...(idx.targetsByFile.get(idA) ?? [])]).toEqual([idB, idC]);
    expect([...(idx.targetsByFile.get(idB) ?? [])]).toEqual([idD]);
    expect([...(idx.targetsByFile.get(idC) ?? [])]).toEqual([idD]);

    const inD = idx.edgesByTarget.get(idD);
    expect(inD?.length).toBe(2);
    const sources = inD?.map((e) => e.from) ?? [];
    expect(sources).toContain(idB);
    expect(sources).toContain(idC);
  });

  it('multiple imports same target: A imports ./b static AND dynamic — bucket sorted by kind', () => {
    const specs: FileSpec[] = [
      {
        path: '/proj/a.ts',
        imports: ['./b', './b'],
        kinds: ['static', 'dynamic'],
      },
      { path: '/proj/b.ts', imports: [] },
    ];
    const files = makeFileNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const idx = buildReverseIndices(graph);

    const idA = fileIdFor(files, '/proj/a.ts');
    const idB = fileIdFor(files, '/proj/b.ts');

    // targetsByFile collapses parallel edges into a single Set entry.
    expect([...(idx.targetsByFile.get(idA) ?? [])]).toEqual([idB]);

    // edgesByTarget keeps both edges, sorted by (from, kind, specifier).
    // 'dynamic' < 'static' lexicographically, so dynamic comes first.
    const inB = idx.edgesByTarget.get(idB);
    expect(inB?.length).toBe(2);
    expect(inB?.[0]?.kind).toBe('dynamic');
    expect(inB?.[1]?.kind).toBe('static');
    expect(inB?.every((e) => e.from === idA)).toBe(true);
  });

  it('self-import A → A: targetsByFile[A] = {A}, edgesByTarget[A] includes A→A', () => {
    const specs: FileSpec[] = [{ path: '/proj/a.ts', imports: ['./a'] }];
    const files = makeFileNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const idx = buildReverseIndices(graph);

    const idA = fileIdFor(files, '/proj/a.ts');
    expect([...(idx.targetsByFile.get(idA) ?? [])]).toEqual([idA]);
    const inA = idx.edgesByTarget.get(idA);
    expect(inA?.length).toBe(1);
    expect(inA?.[0]?.from).toBe(idA);
    expect(inA?.[0]?.to).toBe(idA);
  });

  it('empty graph: both indices are empty Maps', () => {
    const specs: FileSpec[] = [{ path: '/proj/a.ts', imports: [] }];
    const files = makeFileNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const idx = buildReverseIndices(graph);

    expect(idx.targetsByFile.size).toBe(0);
    expect(idx.edgesByTarget.size).toBe(0);
  });

  it('determinism: build twice on same Graph → byte-equal JSON.stringify', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: ['./b', './c'] },
      { path: '/proj/b.ts', imports: ['./d'] },
      { path: '/proj/c.ts', imports: ['./d'] },
      { path: '/proj/d.ts', imports: [] },
    ];
    const files = makeFileNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const a = buildReverseIndices(graph);
    const b = buildReverseIndices(graph);

    const shape = (i: ReturnType<typeof buildReverseIndices>) => ({
      byTarget: [...i.edgesByTarget.entries()],
      targetsByFile: [...i.targetsByFile.entries()].map(([id, set]) => [id, [...set]] as const),
    });
    expect(JSON.stringify(shape(a))).toBe(JSON.stringify(shape(b)));
  });

  it('edgesByTarget bucket arrays sorted by (from, kind, specifier)', () => {
    // Two distinct sources B and C both import D, plus B imports D twice with
    // different kinds. Bucket for D should sort by (from, kind, specifier).
    const specs: FileSpec[] = [
      {
        path: '/proj/b.ts',
        imports: ['./d', './d'],
        kinds: ['static', 'type'],
      },
      { path: '/proj/c.ts', imports: ['./d'] },
      { path: '/proj/d.ts', imports: [] },
    ];
    const files = makeFileNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const idx = buildReverseIndices(graph);

    const idD = fileIdFor(files, '/proj/d.ts');
    const inD = idx.edgesByTarget.get(idD);
    expect(inD?.length).toBe(3);
    // Each consecutive pair must satisfy the canonical ordering.
    for (let i = 1; i < (inD?.length ?? 0); i++) {
      const prev = inD?.[i - 1];
      const cur = inD?.[i];
      if (prev === undefined || cur === undefined) continue;
      const ok =
        prev.from < cur.from ||
        (prev.from === cur.from && prev.kind <= cur.kind) ||
        (prev.from === cur.from && prev.kind === cur.kind && prev.specifier <= cur.specifier);
      expect(ok).toBe(true);
    }
  });

  it('targetsByFile Set iteration is in numeric FileId order', () => {
    // A imports D, B, C — three edges from A to three targets with FileIds
    // dictated by path-sort. We assert the inner Set iterates ascending.
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: ['./d', './c', './b'] },
      { path: '/proj/b.ts', imports: [] },
      { path: '/proj/c.ts', imports: [] },
      { path: '/proj/d.ts', imports: [] },
    ];
    const files = makeFileNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const idx = buildReverseIndices(graph);

    const idA = fileIdFor(files, '/proj/a.ts');
    const members = [...(idx.targetsByFile.get(idA) ?? [])];
    expect(members.length).toBe(3);
    for (let i = 1; i < members.length; i++) {
      const prev = members[i - 1];
      const cur = members[i];
      if (prev === undefined || cur === undefined) continue;
      expect((prev as number) <= (cur as number)).toBe(true);
    }
  });

  it('targetsByFile outer Map iteration is in numeric FileId order', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: ['./d'] },
      { path: '/proj/b.ts', imports: ['./d'] },
      { path: '/proj/c.ts', imports: ['./d'] },
      { path: '/proj/d.ts', imports: [] },
    ];
    const files = makeFileNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const idx = buildReverseIndices(graph);

    const sources = [...idx.targetsByFile.keys()];
    for (let i = 1; i < sources.length; i++) {
      const prev = sources[i - 1];
      const cur = sources[i];
      if (prev === undefined || cur === undefined) continue;
      expect((prev as number) <= (cur as number)).toBe(true);
    }
  });

  it('ROOT_FILE_ID handling: unresolved imports map to to=0; targetsByFile and edgesByTarget reflect it', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: ['./missing', 'react'] },
      { path: '/proj/b.ts', imports: ['./gone'] },
    ];
    const files = makeFileNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const idx = buildReverseIndices(graph);

    const idA = fileIdFor(files, '/proj/a.ts');
    const idB = fileIdFor(files, '/proj/b.ts');

    // targetsByFile: each unresolvable edge points at ROOT_FILE_ID.
    expect([...(idx.targetsByFile.get(idA) ?? [])]).toEqual([ROOT_FILE_ID]);
    expect([...(idx.targetsByFile.get(idB) ?? [])]).toEqual([ROOT_FILE_ID]);

    // edgesByTarget: ROOT bucket holds all three unresolvable edges.
    const inRoot = idx.edgesByTarget.get(ROOT_FILE_ID);
    expect(inRoot?.length).toBe(3);
    expect(inRoot?.every((e) => !e.resolvable)).toBe(true);
  });
});
