/**
 * build.ts — Phase 3d.3 (T091) — module-graph construction.
 *
 * `buildGraph(options)` consumes the per-file `FileNode[]` (each carrying its
 * `Inventory` from @fugazi/extract) and the `ResolverContext` from Phase 3d.2,
 * walks every inventory's imports, resolves each specifier, and emits a frozen
 * `Graph`.
 *
 * Algorithm:
 *
 *   1. Build `pathToFileId` from the input FileNode array.
 *   2. For each FileNode, walk `inventory.imports[]`. Every import record
 *      produces an edge — including `kind: 'reexport'`. Re-exports are NOT
 *      filtered out at this layer: `export { x } from './m'` creates a
 *      `static` edge with the same specifier as the re-export source. The
 *      re-export semantics (which named exports flow through the barrel) are
 *      added in Phase 3d.4 on top of these edges via chain propagation.
 *   3. Each specifier is resolved via the unified `resolve()` dispatcher.
 *      Resolution outcomes map as follows:
 *        - `kind: 'resolved'`  → `to = pathToFileId.get(target)` if present,
 *                                 else `to = ROOT_FILE_ID` and `resolvable = false`
 *                                 (target is on disk but not part of the
 *                                  project file set — e.g. a build-output JS
 *                                  file outside the analysed source tree).
 *        - `kind: 'external'`  → `to = ROOT_FILE_ID`, `resolvable = false`.
 *        - `kind: 'unresolved'` → `to = ROOT_FILE_ID`, `resolvable = false`.
 *   4. Each import record is classified via `classifyEdgeKind` (see
 *      `./edge-kinds.ts`).
 *   5. Edges are sorted deterministically by `(from, to, kind, specifier)`.
 *      The sort uses subtraction on FileIds (safe — small non-negative
 *      integers per Phase 3d.1) and lexicographic comparison on `kind` and
 *      `specifier` strings, never `localeCompare`.
 *   6. The reverse index `edgesByTarget` is built by iterating the canonical
 *      `edges` array in order; this guarantees sub-array ordering matches the
 *      top-level edge order. Targets enter the Map in numeric `to` order
 *      (because `edges` is already sorted by `to` after the primary `from`
 *      sort — but we preserve a stable secondary order with a small extra
 *      pass over `[...edges].sort(byTarget)` so the Map's INSERTION order is
 *      `to`-major). See "edgesByTarget construction" below.
 *   7. Everything is `Object.freeze`d before return.
 *
 * Determinism (NFR-1 / SC-15): two runs on the same `BuildGraphOptions`
 * produce byte-equal `JSON.stringify(graph)`. No `Math.random`, no `Date.now`,
 * no `process.hrtime` are reachable from this module.
 */

import type { Import } from '@fugazi/extract';
import { type FileId, ROOT_FILE_ID, compareFileIds } from '@fugazi/types';
import { classifyEdgeKind as defaultClassifyEdgeKind } from './edge-kinds.js';
import type { FsAdapter, ResolverContext } from './resolve/index.js';
import { resolve as resolveSpecifier } from './resolve/index.js';
import type { Edge, EdgeKind, FileNode, Graph } from './types.js';

export interface BuildGraphOptions {
  /**
   * Input FileNodes — one per project file. The id field is the path-sorted
   * FileId from `assignFileIds` (Phase 3d.1); callers are expected to have
   * passed paths through that pass already so the input order matches the
   * canonical FileId order.
   */
  readonly files: readonly FileNode[];
  /**
   * Resolver context (Phase 3d.2). Same shape passed to `resolve()`.
   */
  readonly resolverContext: ResolverContext;
  /**
   * Optional shared FsAdapter override. When omitted the resolver falls back
   * to `resolverContext.fs ?? nodeFsAdapter`.
   */
  readonly fs?: FsAdapter;
  /**
   * Optional edge-kind classifier override. Defaults to `classifyEdgeKind`.
   * Useful for tests that need to force-route an Import record through a
   * specific branch.
   */
  readonly classifyEdge?: (record: Import) => EdgeKind;
}

/**
 * Build a frozen module graph. Synchronous, never throws on resolution
 * failures — unresolvable specifiers degrade to `to = ROOT_FILE_ID` with
 * `resolvable: false`.
 */
export function buildGraph(options: BuildGraphOptions): Graph {
  const { files, resolverContext, fs, classifyEdge } = options;
  const classify = classifyEdge ?? defaultClassifyEdgeKind;

  // Step 1: path → FileId map. The input FileNode array IS the canonical
  // file order; we trust the caller to have used `assignFileIds` upstream.
  const pathToFileId = new Map<string, FileId>();
  for (const node of files) {
    pathToFileId.set(node.path, node.id);
  }

  // Step 2 + 3 + 4: walk every file's imports, resolve, classify, append.
  const ctx: ResolverContext = fs !== undefined ? { ...resolverContext, fs } : resolverContext;
  const accumulated: Edge[] = [];

  for (const node of files) {
    for (const importRecord of node.inventory.imports) {
      const edgeKind = classify(importRecord);
      const targetId = resolveTargetId(importRecord, node.path, ctx, pathToFileId);
      accumulated.push(
        Object.freeze({
          from: node.id,
          to: targetId.id,
          kind: edgeKind,
          specifier: importRecord.source,
          resolvable: targetId.resolvable,
          loc: importRecord.range,
        }),
      );
    }
  }

  // Step 5: deterministic sort by (from, to, kind, specifier).
  const sortedEdges = accumulated.slice().sort(compareEdges);

  // Step 6: edgesByTarget reverse index. To guarantee the Map's INSERTION
  // order is numeric-`to`-major (independent of how `from` interleaves), we
  // collect edges into per-target buckets via a second canonical sort, then
  // walk the unique `to` values in ascending FileId order.
  const byTarget = new Map<FileId, Edge[]>();
  // Distinct `to` values, sorted ascending — this fixes Map insertion order.
  const distinctTargets: FileId[] = [];
  const seenTargets = new Set<FileId>();
  for (const edge of sortedEdges.slice().sort(compareEdgesByTargetFirst)) {
    if (!seenTargets.has(edge.to)) {
      seenTargets.add(edge.to);
      distinctTargets.push(edge.to);
    }
  }
  // Pre-seed the Map in numeric order so `Map.keys()` walks `to`s ascending.
  for (const target of distinctTargets) {
    byTarget.set(target, []);
  }
  // Fill each bucket using the canonical (from, to, kind, specifier) order
  // so each value array is sorted by `from, kind, specifier` (the `to` is
  // constant within a bucket).
  for (const edge of sortedEdges) {
    const bucket = byTarget.get(edge.to);
    // bucket is guaranteed non-undefined: every edge.to was seeded above.
    if (bucket !== undefined) {
      bucket.push(edge);
    }
  }

  // Step 7: freeze. Each value array becomes readonly via cast; the Map
  // itself is frozen-by-reference inside the Graph object.
  const frozenByTarget = new Map<FileId, readonly Edge[]>();
  for (const [target, bucket] of byTarget) {
    frozenByTarget.set(target, Object.freeze(bucket.slice()));
  }

  // Files Map preserves input order (which callers ensured is path-sorted).
  const filesMap = new Map<FileId, FileNode>();
  for (const node of files) {
    filesMap.set(node.id, node);
  }

  return Object.freeze({
    files: filesMap,
    edges: Object.freeze(sortedEdges),
    edgesByTarget: frozenByTarget,
  }) satisfies Graph;
}

/**
 * Resolve an import record to a target FileId plus its `resolvable` flag.
 * Pure helper — never throws.
 */
function resolveTargetId(
  importRecord: Import,
  fromPath: string,
  ctx: ResolverContext,
  pathToFileId: ReadonlyMap<string, FileId>,
): { readonly id: FileId; readonly resolvable: boolean } {
  // Imports the visitor already flagged as non-resolvable (e.g. dynamic
  // template-literal arguments) collapse straight to the project root.
  if (!importRecord.resolvable) {
    return { id: ROOT_FILE_ID, resolvable: false };
  }
  const result = resolveSpecifier(importRecord.source, fromPath, ctx);
  switch (result.kind) {
    case 'resolved': {
      const id = pathToFileId.get(result.target);
      if (id !== undefined) {
        return { id, resolvable: true };
      }
      // Resolved on disk but outside the project file set — treat as
      // out-of-project and bucket under ROOT_FILE_ID.
      return { id: ROOT_FILE_ID, resolvable: false };
    }
    case 'external':
    case 'unresolved':
      return { id: ROOT_FILE_ID, resolvable: false };
  }
}

/**
 * Compare two edges by `(from, to, kind, specifier)`.
 *
 * `kind` and `specifier` are compared via bare `<`/`>` so the ordering is
 * locale-independent (NFR-1). FileIds are small non-negative integers so
 * subtraction is safe.
 */
function compareEdges(a: Edge, b: Edge): number {
  const fromDelta = compareFileIds(a.from, b.from);
  if (fromDelta !== 0) return fromDelta;
  const toDelta = compareFileIds(a.to, b.to);
  if (toDelta !== 0) return toDelta;
  if (a.kind < b.kind) return -1;
  if (a.kind > b.kind) return 1;
  if (a.specifier < b.specifier) return -1;
  if (a.specifier > b.specifier) return 1;
  return 0;
}

/**
 * Secondary sort: target-major, used only to compute the canonical insertion
 * order for the `edgesByTarget` Map. The actual edge sub-array contents are
 * filled from the primary `(from, to, kind, specifier)` sort so cross-bucket
 * ordering stays consistent.
 */
function compareEdgesByTargetFirst(a: Edge, b: Edge): number {
  const toDelta = compareFileIds(a.to, b.to);
  if (toDelta !== 0) return toDelta;
  return compareEdges(a, b);
}
