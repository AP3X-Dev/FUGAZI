/**
 * re-exports-cycles.test.ts — Phase 3d.4 (T098) acceptance suite.
 *
 * Exercises `detectReexportCycles` against synthetic graphs:
 *   - 2-cycle  A ↔ B
 *   - 3-cycle  A → B → C → A
 *   - Cycle with non-cycle branch  A ↔ B + A → C (no back edge)
 *   - Self-loop  A → A
 *   - Two disjoint cycles
 *   - DAG (no cycles)
 *
 * Tarjan must terminate on every input. Cycles do NOT halt propagation —
 * `propagateReExports` over the same input is asserted to converge cleanly.
 */

import type { Declaration, Import, Inventory } from '@fugazi/extract';
import { type FileId, type Range, assignFileIds } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../build.js';
import { detectReexportCycles } from '../re-exports/cycles.js';
import { propagateReExports } from '../re-exports/propagate.js';
import { createMemoryFsAdapter } from '../resolve/fs-adapter.js';
import type { ResolverContext } from '../resolve/index.js';
import type { FileNode } from '../types.js';

const ZERO_RANGE: Range = {
  start: { line: 1, column: 0, byteOffset: 0 },
  end: { line: 1, column: 1, byteOffset: 1 },
};

interface FileSpec {
  readonly path: string;
  readonly imports: readonly { source: string; kind?: Import['kind'] }[];
  readonly exports?: readonly string[];
}

function makeNodes(specs: readonly FileSpec[]): readonly FileNode[] {
  const ids = assignFileIds(specs.map((s) => s.path));
  const sorted = [...specs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sorted.map((spec) => {
    const id = ids.get(spec.path);
    if (id === undefined) throw new Error(`no id for ${spec.path}`);
    const imports: Import[] = spec.imports.map((rec) => ({
      kind: rec.kind ?? 'reexport',
      source: rec.source,
      resolvable: true,
      range: ZERO_RANGE,
    }));
    const declarations: Declaration[] = (spec.exports ?? []).map((name) => ({
      kind: 'variable',
      name,
      exported: true,
      range: ZERO_RANGE,
      members: [],
    }));
    const inventory: Inventory = { declarations, imports, usages: [] };
    return { id, path: spec.path, inventory } satisfies FileNode;
  });
}

function ctxFor(specs: readonly FileSpec[]): ResolverContext {
  const record: Record<string, string> = {};
  for (const spec of specs) record[spec.path] = '';
  return { projectRoot: '/proj', fs: createMemoryFsAdapter(record) };
}

describe('detectReexportCycles — Tarjan SCC over re-export subgraph', () => {
  it('2-cycle: A ↔ B is reported as one SCC of size 2', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: [{ source: './b' }] },
      { path: '/proj/b.ts', imports: [{ source: './a' }] },
    ];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const cycles = detectReexportCycles(graph);
    expect(cycles.length).toBe(1);
    const cycle = cycles[0];
    if (cycle === undefined) throw new Error('expected one cycle');
    expect(cycle.length).toBe(2);
    const idA = files.find((f) => f.path === '/proj/a.ts')?.id as FileId;
    const idB = files.find((f) => f.path === '/proj/b.ts')?.id as FileId;
    expect(cycle).toContain(idA);
    expect(cycle).toContain(idB);
  });

  it('3-cycle: A → B → C → A', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: [{ source: './b' }] },
      { path: '/proj/b.ts', imports: [{ source: './c' }] },
      { path: '/proj/c.ts', imports: [{ source: './a' }] },
    ];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const cycles = detectReexportCycles(graph);
    expect(cycles.length).toBe(1);
    expect(cycles[0]?.length).toBe(3);
  });

  it('cycle with non-cycle branch: A ↔ B + A → C', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: [{ source: './b' }, { source: './c' }] },
      { path: '/proj/b.ts', imports: [{ source: './a' }] },
      { path: '/proj/c.ts', imports: [], exports: ['cName'] },
    ];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const cycles = detectReexportCycles(graph);
    // One non-trivial SCC ({A,B}). C is its own SCC of size 1 with no self
    // loop — excluded.
    expect(cycles.length).toBe(1);
    expect(cycles[0]?.length).toBe(2);
  });

  it('self-loop: A → A is reported as a 1-cycle', () => {
    const specs: FileSpec[] = [{ path: '/proj/a.ts', imports: [{ source: './a' }] }];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const cycles = detectReexportCycles(graph);
    expect(cycles.length).toBe(1);
    const idA = files[0]?.id as FileId;
    expect(cycles[0]).toEqual([idA]);
  });

  it('two disjoint cycles: A↔B and X↔Y are reported separately', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: [{ source: './b' }] },
      { path: '/proj/b.ts', imports: [{ source: './a' }] },
      { path: '/proj/x.ts', imports: [{ source: './y' }] },
      { path: '/proj/y.ts', imports: [{ source: './x' }] },
    ];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const cycles = detectReexportCycles(graph);
    expect(cycles.length).toBe(2);
    // Sorted by lowest fileId.
    const c1 = cycles[0];
    const c2 = cycles[1];
    if (c1 === undefined || c2 === undefined) throw new Error('expected two cycles');
    const min1 = c1[0];
    const min2 = c2[0];
    if (min1 === undefined || min2 === undefined) throw new Error('empty cycles');
    expect((min1 as unknown as number) < (min2 as unknown as number)).toBe(true);
  });

  it('DAG produces no cycles', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: [{ source: './b' }, { source: './c' }] },
      { path: '/proj/b.ts', imports: [{ source: './d' }] },
      { path: '/proj/c.ts', imports: [{ source: './d' }] },
      { path: '/proj/d.ts', imports: [], exports: ['leaf'] },
    ];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const cycles = detectReexportCycles(graph);
    expect(cycles).toEqual([]);
  });

  it('cycles do not halt propagation — engine still terminates', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: [{ source: './b' }], exports: ['fromA'] },
      { path: '/proj/b.ts', imports: [{ source: './a' }], exports: ['fromB'] },
    ];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const result = propagateReExports(graph);
    const idA = files.find((f) => f.path === '/proj/a.ts')?.id as FileId;
    const idB = files.find((f) => f.path === '/proj/b.ts')?.id as FileId;
    // Each side should now see both names.
    expect(result.exports.get(idA)?.has('fromA')).toBe(true);
    expect(result.exports.get(idA)?.has('fromB')).toBe(true);
    expect(result.exports.get(idB)?.has('fromA')).toBe(true);
    expect(result.exports.get(idB)?.has('fromB')).toBe(true);
    // No cap-hit on a tiny cycle — converges in 2 iterations.
    expect(result.diagnostics.some((d) => d.kind === 'cap-hit')).toBe(false);
  });

  it('cycles list is sorted by lowest fileId across runs (determinism)', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: [{ source: './b' }] },
      { path: '/proj/b.ts', imports: [{ source: './a' }] },
      { path: '/proj/x.ts', imports: [{ source: './y' }] },
      { path: '/proj/y.ts', imports: [{ source: './x' }] },
    ];
    const files = makeNodes(specs);
    const ctx = ctxFor(specs);
    const c1 = detectReexportCycles(buildGraph({ files, resolverContext: ctx }));
    const c2 = detectReexportCycles(buildGraph({ files, resolverContext: ctx }));
    expect(JSON.stringify(c1)).toBe(JSON.stringify(c2));
  });

  it('isolated files (no re-exports) produce no cycles', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: [], exports: ['a'] },
      { path: '/proj/b.ts', imports: [], exports: ['b'] },
    ];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    expect(detectReexportCycles(graph)).toEqual([]);
  });
});
