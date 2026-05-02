/**
 * reverse-index.ts — Phase 3d.5 (T102-T103) — graph reverse indices.
 *
 * `buildReverseIndices(graph)` returns the two reverse indices most analyses
 * need on top of the canonical Phase 3d.3 graph:
 *
 *   1. `edgesByTarget` — for each `to` FileId, the list of incoming edges in
 *      the canonical `(from, kind, specifier)` order. The Phase 3d.3 graph
 *      already exposes this Map directly on `Graph.edgesByTarget`, so this
 *      helper passes that reference through unchanged. Re-publishing it from
 *      a sibling helper lets analyses depend on `buildReverseIndices` alone
 *      rather than threading the whole `Graph` through every layer.
 *
 *   2. `targetsByFile` — for each `from` FileId, the set of `to` FileIds it
 *      depends on. Built in a single linear pass over `graph.edges` (O(E)).
 *      The outer Map's keys iterate in ascending FileId order, and each Set
 *      iterates in ascending FileId order matching that of its members.
 *
 * Determinism (NFR-1 / SC-15):
 *   - Single linear scan, no nested loops over edges.
 *   - All keys are inserted in sorted order so iteration is reproducible.
 *   - Each Set is rebuilt from a sorted member array so its iteration order
 *     matches numeric FileId ascending.
 *   - Top-level `ReverseIndices` object is `Object.freeze`d before return.
 *   - The returned `targetsByFile` Map is frozen-by-reference; callers cannot
 *     mutate it without violating the `ReadonlyMap`/`ReadonlySet` types.
 *
 * Self-imports (`A → A`) and unresolvable imports (`to = ROOT_FILE_ID`) are
 * preserved verbatim: `targetsByFile.get(A)` includes `A` for the former, and
 * unresolved edges all collapse to the `ROOT_FILE_ID` (= 0) bucket.
 */

import { type FileId, compareFileIds } from '@fugazi/types';
import type { Edge, Graph } from './types.js';

/**
 * Reverse-index pair derived from a frozen `Graph`. Both maps are immutable
 * and deterministically ordered (see module docblock).
 */
export interface ReverseIndices {
  /**
   * For each target `FileId`, the list of edges whose `to` field is that
   * target. Identical to `Graph.edgesByTarget` — re-published here so
   * downstream analyses can depend on this helper alone. Bucket arrays are
   * sorted by `(from, kind, specifier)` per the Phase 3d.3 contract.
   */
  readonly edgesByTarget: ReadonlyMap<FileId, readonly Edge[]>;
  /**
   * For each source `FileId`, the set of `FileId`s it depends on. The outer
   * Map iterates in ascending FileId order; each inner ReadonlySet iterates
   * in ascending FileId order over its members.
   */
  readonly targetsByFile: ReadonlyMap<FileId, ReadonlySet<FileId>>;
}

/**
 * Build the reverse-index pair for `graph`. Pure, synchronous, O(E).
 */
export function buildReverseIndices(graph: Graph): ReverseIndices {
  // Step 1: pass-through edgesByTarget — the Phase 3d.3 builder already
  // produced it in canonical order, and ReadonlyMap<readonly Edge[]> means
  // callers cannot mutate the buckets. No copy required.
  const edgesByTarget = graph.edgesByTarget;

  // Step 2: walk edges once, accumulating per-source mutable sets. We use
  // plain `Set<FileId>` here for O(1) membership; the canonical-order Set
  // is rebuilt below.
  const accumulator = new Map<FileId, Set<FileId>>();
  for (const edge of graph.edges) {
    let bucket = accumulator.get(edge.from);
    if (bucket === undefined) {
      bucket = new Set<FileId>();
      accumulator.set(edge.from, bucket);
    }
    bucket.add(edge.to);
  }

  // Step 3: rebuild outer Map in ascending FileId order, with each value Set
  // also constructed from a sorted member array so its iteration order is
  // ascending FileId. `compareFileIds` is the canonical brand-aware
  // comparator from @fugazi/types.
  const sortedSources = [...accumulator.keys()].sort(compareFileIds);
  const targetsByFile = new Map<FileId, ReadonlySet<FileId>>();
  for (const source of sortedSources) {
    const rawBucket = accumulator.get(source);
    // Defensive: every key in `sortedSources` came from `accumulator.keys()`,
    // so this lookup cannot return undefined under normal Map semantics. The
    // explicit guard satisfies `noUncheckedIndexedAccess` without resorting
    // to a non-null assertion.
    if (rawBucket === undefined) continue;
    const sortedMembers = [...rawBucket].sort(compareFileIds);
    const orderedSet: ReadonlySet<FileId> = new Set<FileId>(sortedMembers);
    targetsByFile.set(source, orderedSet);
  }

  return Object.freeze({
    edgesByTarget,
    targetsByFile,
  }) satisfies ReverseIndices;
}
