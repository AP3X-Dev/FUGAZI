/**
 * entry-targets.ts — Phase 3d.4 (T100) — entry-point star-re-export targets.
 *
 * Builds a two-layer index that captures, for a given set of project entry
 * points, the full transitive set of names visible "through the barrel" from
 * each entry. Downstream dead-code reasoning treats anything reachable from
 * an entry's star chain as live.
 *
 *   Layer 1 (`directTargets`): for each entry FileId, the set of file IDs
 *     directly star-re-exported. `entry → { firstHopTarget, … }`.
 *
 *   Layer 2 (`transitiveExports`): for each layer-1 target file, the FULL
 *     set of export names visible at that target after collapsing all
 *     subsequent star re-export hops. `target → { name, … }`.
 *
 * Why two layers
 * --------------
 *
 *   Layer 1 lets a reporter answer "which barrels does this entry directly
 *   wire in?" without re-traversing the chain. Layer 2 answers "what live
 *   names ride through that chain?". Splitting the two avoids recomputation
 *   when only one shape is needed (e.g. a unused-exports reporter only needs
 *   layer 2; a dependency-graph diagram only needs layer 1).
 *
 * Determinism (NFR-1 / SC-15)
 * ---------------------------
 *
 *   - Both Maps insert keys in FileId-ascending order.
 *   - Sets iterate name-sorted (string `<`/`>` comparator, never localeCompare).
 *   - The BFS visits children in FileId-ascending order, so transitive-export
 *     accumulation is order-stable across runs.
 *   - The `propagated` argument is consumed read-only.
 */

import { type FileId, ROOT_FILE_ID, compareFileIds } from '@fugazi/types';
import type { Graph } from '../types.js';
import type { PropagatedExports } from './propagate.js';
import { isReExportEdge } from './propagate.js';

export interface EntryStarTargets {
  /**
   * Layer 1: entry → directly star-re-exported file IDs.
   */
  readonly directTargets: ReadonlyMap<FileId, ReadonlySet<FileId>>;
  /**
   * Layer 2: target file → full transitive export-name set, including all
   * names reached through subsequent star re-export hops.
   */
  readonly transitiveExports: ReadonlyMap<FileId, ReadonlySet<string>>;
}

/**
 * Build the two-layer entry-target index.
 *
 * Pure, synchronous, never throws.
 *
 * `entryPoints` may contain duplicates or entries not present in `graph.files`
 * — duplicates are de-duplicated, and unknown entries are skipped silently.
 */
export function buildEntryStarTargets(
  graph: Graph,
  entryPoints: readonly FileId[],
  propagated: PropagatedExports,
): EntryStarTargets {
  // Pre-build the re-export adjacency, sorted ascending so BFS is stable.
  const reExportAdj = buildReExportAdjacency(graph);

  // Layer 1: each entry → directly-targeted barrels.
  const directTargetsBuckets = new Map<FileId, Set<FileId>>();
  const dedupEntries = [...new Set(entryPoints)].sort(compareFileIds);

  for (const entry of dedupEntries) {
    if (!graph.files.has(entry)) continue;
    const direct = reExportAdj.get(entry);
    if (direct === undefined) continue;
    const dst = new Set<FileId>();
    for (const t of direct) {
      if (t === ROOT_FILE_ID) continue;
      dst.add(t);
    }
    if (dst.size > 0) {
      directTargetsBuckets.set(entry, dst);
    }
  }

  // Freeze layer 1 — Maps inserted in entry-FileId ascending order.
  const directTargets = new Map<FileId, ReadonlySet<FileId>>();
  for (const entry of [...directTargetsBuckets.keys()].sort(compareFileIds)) {
    const set = directTargetsBuckets.get(entry);
    if (set === undefined) continue;
    const sorted = new Set<FileId>([...set].sort(compareFileIds));
    directTargets.set(entry, sorted);
  }

  // Layer 2: BFS from each layer-1 target accumulating ALL names reachable
  // via the star chain. We BFS over the re-export subgraph; per-node export
  // sets come from the propagated map (already a fixed point — saves us
  // re-running the algorithm here).
  const targetUniverse = new Set<FileId>();
  for (const set of directTargets.values()) {
    for (const t of set) targetUniverse.add(t);
  }

  const transitiveBuckets = new Map<FileId, Set<string>>();
  for (const target of [...targetUniverse].sort(compareFileIds)) {
    const accumulated = bfsTransitiveExports(target, reExportAdj, propagated);
    transitiveBuckets.set(target, accumulated);
  }

  // Freeze layer 2 — Maps inserted in target-FileId ascending order.
  const transitiveExports = new Map<FileId, ReadonlySet<string>>();
  for (const target of [...transitiveBuckets.keys()].sort(compareFileIds)) {
    const set = transitiveBuckets.get(target);
    if (set === undefined) continue;
    transitiveExports.set(target, new Set<string>([...set].sort()));
  }

  return Object.freeze({
    directTargets,
    transitiveExports,
  }) satisfies EntryStarTargets;
}

/**
 * BFS over the re-export subgraph rooted at `start`, accumulating the union
 * of all reachable nodes' export sets (taken from `propagated.exports`).
 *
 * The starting node IS included in the result.
 */
function bfsTransitiveExports(
  start: FileId,
  reExportAdj: ReadonlyMap<FileId, readonly FileId[]>,
  propagated: PropagatedExports,
): Set<string> {
  const visited = new Set<FileId>();
  const accumulated = new Set<string>();
  // Use a numeric queue (as array) — bounded depth, so unshift cost is fine.
  const queue: FileId[] = [start];
  visited.add(start);

  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) break;
    const names = propagated.exports.get(node);
    if (names !== undefined) {
      for (const name of names) {
        accumulated.add(name);
      }
    }
    const children = reExportAdj.get(node) ?? [];
    for (const child of children) {
      if (visited.has(child)) continue;
      visited.add(child);
      queue.push(child);
    }
  }

  return accumulated;
}

/**
 * Same shape as `cycles.ts::buildReExportAdjacency` — duplicated locally to
 * avoid an import cycle. Builds the re-export-only adjacency list with
 * targets sorted ascending.
 */
function buildReExportAdjacency(graph: Graph): ReadonlyMap<FileId, readonly FileId[]> {
  const buckets = new Map<FileId, FileId[]>();
  for (const edge of graph.edges) {
    if (!isReExportEdge(edge, graph)) continue;
    const list = buckets.get(edge.from);
    if (list === undefined) {
      buckets.set(edge.from, [edge.to]);
    } else {
      list.push(edge.to);
    }
  }
  const sorted = new Map<FileId, readonly FileId[]>();
  for (const from of [...buckets.keys()].sort(compareFileIds)) {
    const raw = buckets.get(from);
    if (raw === undefined) continue;
    const dedup = [...new Set(raw)].sort(compareFileIds);
    sorted.set(from, dedup);
  }
  return sorted;
}
