/**
 * star-exports.test.ts — Phase 3d.4 (T100) acceptance suite.
 *
 * Exercises `synthesizeStarExports` and `buildEntryStarTargets` against
 * synthetic graphs:
 *   - bare `export *` produces synthetic name `__star_${toFile}__`
 *   - `export * as ns` (via aliasOverride) produces `__star_${toFile}_as_ns__`
 *   - multi-target entry (entry star-re-exports two siblings) covers layer-1
 *   - chained barrels through multiple layers cover layer-2 (transitive)
 *   - synthetic-symbol naming is stable across runs
 *   - `isSyntheticStarSymbol` filters reporter output correctly
 */

import type { Declaration, Import, Inventory } from '@fugazi/extract';
import { type FileId, type Range, assignFileIds } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../build.js';
import { buildEntryStarTargets } from '../re-exports/entry-targets.js';
import { propagateReExports } from '../re-exports/propagate.js';
import {
  type StarAliasOverride,
  isSyntheticStarSymbol,
  synthesizeStarExports,
  synthesizeStarSymbolName,
} from '../re-exports/star.js';
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

describe('synthesizeStarExports + isSyntheticStarSymbol', () => {
  it(`bare 'export *' → synthetic name __star_<id>__`, () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: [{ source: './b' }] },
      { path: '/proj/b.ts', imports: [], exports: ['x'] },
    ];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const stars = synthesizeStarExports(graph);
    expect(stars.symbols.length).toBe(1);
    const sym = stars.symbols[0];
    if (sym === undefined) throw new Error('expected one synthetic');
    const idB = files.find((f) => f.path === '/proj/b.ts')?.id as FileId;
    expect(sym.name).toBe(`__star_${idB as unknown as number}__`);
    expect(isSyntheticStarSymbol(sym.name)).toBe(true);
  });

  it(`'export * as ns' (via aliasOverride) → __star_<id>_as_<ns>__`, () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: [{ source: './b' }] },
      { path: '/proj/b.ts', imports: [], exports: ['x'] },
    ];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const idA = files.find((f) => f.path === '/proj/a.ts')?.id as FileId;
    const idB = files.find((f) => f.path === '/proj/b.ts')?.id as FileId;
    const override: StarAliasOverride = new Map([
      [`${idA as unknown as number}:${idB as unknown as number}`, 'mySpace'],
    ]);
    const stars = synthesizeStarExports(graph, override);
    expect(stars.symbols.length).toBe(1);
    expect(stars.symbols[0]?.name).toBe(`__star_${idB as unknown as number}_as_mySpace__`);
    expect(stars.symbols[0]?.nsName).toBe('mySpace');
  });

  it('multi-target entry: A re-exports both ./b and ./c', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: [{ source: './b' }, { source: './c' }] },
      { path: '/proj/b.ts', imports: [], exports: ['fromB'] },
      { path: '/proj/c.ts', imports: [], exports: ['fromC'] },
    ];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const stars = synthesizeStarExports(graph);
    const idA = files.find((f) => f.path === '/proj/a.ts')?.id as FileId;
    expect(stars.symbols.length).toBe(2);
    const aBucket = stars.byFile.get(idA);
    expect(aBucket?.size).toBe(2);
  });

  it('synthetic-name composer is deterministic (same input → same name)', () => {
    const id1 = 7 as unknown as FileId;
    const a = synthesizeStarSymbolName(id1, null);
    const b = synthesizeStarSymbolName(id1, null);
    expect(a).toBe(b);
    expect(a).toBe('__star_7__');
    const c = synthesizeStarSymbolName(id1, 'ns');
    expect(c).toBe('__star_7_as_ns__');
  });

  it('isSyntheticStarSymbol filters reporter output', () => {
    expect(isSyntheticStarSymbol('__star_3__')).toBe(true);
    expect(isSyntheticStarSymbol('__star_3_as_ns__')).toBe(true);
    expect(isSyntheticStarSymbol('regularExport')).toBe(false);
    expect(isSyntheticStarSymbol('__star_3')).toBe(false);
    expect(isSyntheticStarSymbol('star_3__')).toBe(false);
  });

  it('determinism: byte-equal output across two runs', () => {
    const specs: FileSpec[] = [
      { path: '/proj/a.ts', imports: [{ source: './b' }, { source: './c' }] },
      { path: '/proj/b.ts', imports: [], exports: ['fromB'] },
      { path: '/proj/c.ts', imports: [], exports: ['fromC'] },
    ];
    const files = makeNodes(specs);
    const ctx = ctxFor(specs);
    const s1 = synthesizeStarExports(buildGraph({ files, resolverContext: ctx }));
    const s2 = synthesizeStarExports(buildGraph({ files, resolverContext: ctx }));
    expect(JSON.stringify(s1.symbols)).toBe(JSON.stringify(s2.symbols));
  });

  it('non-resolvable re-export does not produce a synthetic symbol', () => {
    const specs: FileSpec[] = [{ path: '/proj/a.ts', imports: [{ source: './missing' }] }];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const stars = synthesizeStarExports(graph);
    expect(stars.symbols.length).toBe(0);
  });
});

describe('buildEntryStarTargets — entry barrel index', () => {
  it('layer-1 directTargets: entry → first-hop barrel set', () => {
    const specs: FileSpec[] = [
      { path: '/proj/index.ts', imports: [{ source: './a' }, { source: './b' }] },
      { path: '/proj/a.ts', imports: [], exports: ['fromA'] },
      { path: '/proj/b.ts', imports: [], exports: ['fromB'] },
    ];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const propagated = propagateReExports(graph);
    const idIndex = files.find((f) => f.path === '/proj/index.ts')?.id as FileId;
    const idA = files.find((f) => f.path === '/proj/a.ts')?.id as FileId;
    const idB = files.find((f) => f.path === '/proj/b.ts')?.id as FileId;
    const result = buildEntryStarTargets(graph, [idIndex], propagated);
    const direct = result.directTargets.get(idIndex);
    expect(direct?.has(idA)).toBe(true);
    expect(direct?.has(idB)).toBe(true);
  });

  it('layer-2 transitiveExports: BFS through chain collapses names', () => {
    const specs: FileSpec[] = [
      { path: '/proj/index.ts', imports: [{ source: './barrel' }] },
      { path: '/proj/barrel.ts', imports: [{ source: './a' }, { source: './b' }] },
      { path: '/proj/a.ts', imports: [], exports: ['fromA'] },
      { path: '/proj/b.ts', imports: [], exports: ['fromB'] },
    ];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const propagated = propagateReExports(graph);
    const idIndex = files.find((f) => f.path === '/proj/index.ts')?.id as FileId;
    const idBarrel = files.find((f) => f.path === '/proj/barrel.ts')?.id as FileId;
    const result = buildEntryStarTargets(graph, [idIndex], propagated);
    const trans = result.transitiveExports.get(idBarrel);
    expect(trans?.has('fromA')).toBe(true);
    expect(trans?.has('fromB')).toBe(true);
  });

  it('unknown entry FileIds are skipped silently', () => {
    const specs: FileSpec[] = [{ path: '/proj/a.ts', imports: [], exports: ['x'] }];
    const files = makeNodes(specs);
    const graph = buildGraph({ files, resolverContext: ctxFor(specs) });
    const propagated = propagateReExports(graph);
    const ghost = 999 as unknown as FileId;
    const result = buildEntryStarTargets(graph, [ghost], propagated);
    expect(result.directTargets.size).toBe(0);
    expect(result.transitiveExports.size).toBe(0);
  });

  it('determinism: byte-equal output across two runs', () => {
    const specs: FileSpec[] = [
      { path: '/proj/index.ts', imports: [{ source: './barrel' }] },
      { path: '/proj/barrel.ts', imports: [{ source: './a' }, { source: './b' }] },
      { path: '/proj/a.ts', imports: [], exports: ['fromA'] },
      { path: '/proj/b.ts', imports: [], exports: ['fromB'] },
    ];
    const files = makeNodes(specs);
    const ctx = ctxFor(specs);
    const idIndex = files.find((f) => f.path === '/proj/index.ts')?.id as FileId;
    const r1 = buildEntryStarTargets(
      buildGraph({ files, resolverContext: ctx }),
      [idIndex],
      propagateReExports(buildGraph({ files, resolverContext: ctx })),
    );
    const r2 = buildEntryStarTargets(
      buildGraph({ files, resolverContext: ctx }),
      [idIndex],
      propagateReExports(buildGraph({ files, resolverContext: ctx })),
    );
    const shape = (r: typeof r1) => ({
      direct: [...r.directTargets.entries()].map(([k, v]) => [k, [...v]]),
      trans: [...r.transitiveExports.entries()].map(([k, v]) => [k, [...v]]),
    });
    expect(JSON.stringify(shape(r1))).toBe(JSON.stringify(shape(r2)));
  });
});
