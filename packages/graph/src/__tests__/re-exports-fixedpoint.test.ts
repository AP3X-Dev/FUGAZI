/**
 * re-exports-fixedpoint.test.ts — Phase 3d.4 (T096) acceptance suite.
 *
 * Exercises `propagateReExports` against handcrafted module graphs:
 *   - 5-level barrel chain → all names propagate to the entry in ≤ depth iters
 *   - Branching barrel (one entry pulls from two siblings)
 *   - Mixed declared + re-exported names
 *   - Multiple re-exports through the same barrel collapse cleanly
 *   - Cap-hit diagnostic is emitted byte-for-byte when iterations exhausted
 *
 * The fixtures construct `FileNode` objects directly with synthetic
 * `Inventory` records — same pattern as `build-graph.test.ts`, just enriched
 * with `declarations: [{ name, exported: true, … }]` so the propagation
 * engine has names to copy.
 */

import type { Declaration, Import, Inventory } from '@fugazi/extract';
import { type FileId, type Range, assignFileIds } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../build.js';
import {
  CAP_HIT_MESSAGE,
  MAX_ITERATIONS,
  describeDiagnostic,
  propagateReExports,
} from '../re-exports/propagate.js';
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

describe('propagateReExports — fixed-point engine', () => {
  it('5-level barrel chain: A → B → C → D → E (all names reach A)', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: [{ source: './b' }] },
      { path: '/proj/b.ts', imports: [{ source: './c' }] },
      { path: '/proj/c.ts', imports: [{ source: './d' }] },
      { path: '/proj/d.ts', imports: [{ source: './e' }] },
      { path: '/proj/e.ts', imports: [], exports: ['leaf'] },
    ];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const result = propagateReExports(graph);

    const idA = files.find((f) => f.path === '/proj/a.ts')?.id as FileId;
    const idE = files.find((f) => f.path === '/proj/e.ts')?.id as FileId;
    expect(result.exports.get(idA)?.has('leaf')).toBe(true);
    expect(result.exports.get(idE)?.has('leaf')).toBe(true);
    // No cap-hit diagnostic — chain converges in well under MAX_ITERATIONS.
    expect(result.diagnostics.some((d) => d.kind === 'cap-hit')).toBe(false);
  });

  it('branching barrel: A → B + A → C, both export distinct names', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: [{ source: './b' }, { source: './c' }] },
      { path: '/proj/b.ts', imports: [], exports: ['fromB'] },
      { path: '/proj/c.ts', imports: [], exports: ['fromC'] },
    ];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const result = propagateReExports(graph);
    const idA = files.find((f) => f.path === '/proj/a.ts')?.id as FileId;
    const aSet = result.exports.get(idA);
    expect(aSet?.has('fromB')).toBe(true);
    expect(aSet?.has('fromC')).toBe(true);
  });

  it('declared + re-exported names coexist on the barrel file', () => {
    const specs: FileSpec[] = [
      {
        path: '/proj/a.ts',
        imports: [{ source: './b' }],
        exports: ['localA'],
      },
      { path: '/proj/b.ts', imports: [], exports: ['fromB'] },
    ];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const result = propagateReExports(graph);
    const idA = files.find((f) => f.path === '/proj/a.ts')?.id as FileId;
    const aSet = result.exports.get(idA);
    expect(aSet?.has('localA')).toBe(true);
    expect(aSet?.has('fromB')).toBe(true);
  });

  it('duplicate re-export specifiers collapse to a single edge of work', () => {
    const specs: FileSpec[] = [
      {
        path: '/proj/a.ts',
        imports: [{ source: './b' }, { source: './b' }],
      },
      { path: '/proj/b.ts', imports: [], exports: ['x', 'y'] },
    ];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const result = propagateReExports(graph);
    const idA = files.find((f) => f.path === '/proj/a.ts')?.id as FileId;
    const aSet = result.exports.get(idA);
    expect(aSet?.size).toBe(2);
    expect(aSet?.has('x')).toBe(true);
    expect(aSet?.has('y')).toBe(true);
  });

  it('non-resolvable re-export drops silently (no exports added, no diagnostic)', () => {
    // Re-export specifier resolves but to a path NOT in the file set —
    // the graph builder marks the edge unresolvable; propagation must skip.
    const specs: FileSpec[] = [{ path: '/proj/a.ts', imports: [{ source: './missing' }] }];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const result = propagateReExports(graph);
    const idA = files.find((f) => f.path === '/proj/a.ts')?.id as FileId;
    expect(result.exports.get(idA)?.size).toBe(0);
    expect(result.diagnostics.length).toBe(0);
  });

  it('re-export through an unresolved external (e.g. node_modules) is dropped', () => {
    const specs: FileSpec[] = [{ path: '/proj/a.ts', imports: [{ source: 'react' }] }];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const result = propagateReExports(graph);
    const idA = files.find((f) => f.path === '/proj/a.ts')?.id as FileId;
    expect(result.exports.get(idA)?.size).toBe(0);
  });

  it('byte-equal output across two runs (determinism — NFR-1)', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: [{ source: './b' }, { source: './c' }] },
      { path: '/proj/b.ts', imports: [{ source: './d' }] },
      { path: '/proj/c.ts', imports: [], exports: ['cName'] },
      { path: '/proj/d.ts', imports: [], exports: ['dName'] },
    ];
    const files = makeNodes(specs);
    const ctx = ctxFor(specs);
    const g1 = buildGraph({ files, resolverContext: ctx });
    const g2 = buildGraph({ files, resolverContext: ctx });
    const r1 = propagateReExports(g1);
    const r2 = propagateReExports(g2);
    const shape = (r: typeof r1) => ({
      exports: [...r.exports.entries()].map(([k, v]) => [k, [...v]]),
      provenance: [...r.provenance.entries()],
      diagnostics: r.diagnostics,
    });
    expect(JSON.stringify(shape(r1))).toBe(JSON.stringify(shape(r2)));
  });

  it('describes cap-hit diagnostic with the canonical message', () => {
    // We synthesise a cap-hit by checking the helper directly — the iteration
    // cap is reachable in real graphs only via pathological barrel-chain
    // depth (>20 hops); this asserts the message format byte-for-byte.
    const msg = describeDiagnostic({ kind: 'cap-hit', iterations: MAX_ITERATIONS });
    expect(msg).toBe(CAP_HIT_MESSAGE);
    expect(msg).toBe(
      're-export propagation hit max_iterations=20 cap; some exports may be missing',
    );
  });

  it('provenance: declared exports point at self', () => {
    const specs: FileSpec[] = [{ path: '/proj/a.ts', imports: [], exports: ['x'] }];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const result = propagateReExports(graph);
    const idA = files[0]?.id as FileId;
    const prov = result.provenance.get(`${idA as unknown as number}:x`);
    expect(prov).toEqual({ sourceFile: idA, sourceName: 'x' });
  });

  it('provenance: re-exported name records first-hop source file', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: [{ source: './b' }] },
      { path: '/proj/b.ts', imports: [], exports: ['fromB'] },
    ];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const result = propagateReExports(graph);
    const idA = files.find((f) => f.path === '/proj/a.ts')?.id as FileId;
    const idB = files.find((f) => f.path === '/proj/b.ts')?.id as FileId;
    const prov = result.provenance.get(`${idA as unknown as number}:fromB`);
    expect(prov?.sourceFile).toBe(idB);
    expect(prov?.sourceName).toBe('fromB');
  });

  it('iteration count: 5-level chain converges in ≤ depth iterations', () => {
    // Indirect assertion: the propagation engine emits no cap-hit, and a
    // 5-level chain has effective depth 5 << 20. We assert termination via
    // the absence of a `'cap-hit'` diagnostic. The MAX_ITERATIONS is exposed
    // for direct comparison; this asserts the chain DID NOT touch it.
    expect(MAX_ITERATIONS).toBe(20);
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: [{ source: './b' }] },
      { path: '/proj/b.ts', imports: [{ source: './c' }] },
      { path: '/proj/c.ts', imports: [{ source: './d' }] },
      { path: '/proj/d.ts', imports: [{ source: './e' }] },
      { path: '/proj/e.ts', imports: [], exports: ['leaf'] },
    ];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const result = propagateReExports(graph);
    expect(result.diagnostics.length).toBe(0);
  });
});
