/**
 * star.ts — Phase 3d.4 (T099) — synthetic ExportSymbol generation for
 * `export *` and `export * as ns` re-export forms.
 *
 * Star re-exports introduce a "live link" from the source file's exports to
 * every name the target file exports. Downstream analyses (dead-code, unused
 * exports) need a stable handle for that link so they can attribute usages
 * back to the originating barrel even when the underlying target's export
 * set is itself in flux.
 *
 * Synthetic symbol naming
 * -----------------------
 *
 *   - `export * from './m'` → `__star_${targetFileId}__`
 *   - `export * as ns from './m'` → `__star_${targetFileId}_as_${ns}__`
 *
 * The names are deterministic across runs (FileId is path-sorted, ns is
 * verbatim). They are reserved-prefixed (`__star_…__`) so user-facing
 * diagnostics filter them by prefix and never display them.
 *
 * Data limits
 * -----------
 *
 *   The Phase 3c.4 visitor classifies re-exports as `kind: 'reexport'` but
 *   does NOT preserve the per-specifier alias. As a result, this engine
 *   cannot distinguish `export * as ns` from `export *` from
 *   `export { x } from` at the inventory layer — every re-export edge is
 *   treated as the bare-star form (`__star_${targetFileId}__`). When a future
 *   visitor enrichment surfaces alias data, the call site can pass an
 *   optional `aliasOverride` map to drive the namespace-form name.
 */

import { type FileId, ROOT_FILE_ID, compareFileIds } from '@fugazi/types';
import type { Graph } from '../types.js';
import { isReExportEdge } from './propagate.js';

/**
 * A synthetic export symbol introduced by a star re-export. Carries both the
 * canonical name (downstream consumers MUST filter by prefix to skip) and the
 * source/target FileId pair so reachability reasoning can resolve back to the
 * underlying barrel when needed.
 */
export interface SyntheticStarSymbol {
  /** `__star_${targetFileId}__` or `__star_${targetFileId}_as_${ns}__`. */
  readonly name: string;
  /** The file that owns this synthetic export (the barrel). */
  readonly fromFile: FileId;
  /** The target the star points at. */
  readonly toFile: FileId;
  /** `null` for bare `export *`; the namespace name for `export * as ns`. */
  readonly nsName: string | null;
}

export interface SynthesizedStars {
  /** All synthetic symbols, sorted by `(fromFile, toFile, name)`. */
  readonly symbols: readonly SyntheticStarSymbol[];
  /**
   * Per-source-file synthetic-symbol Set. Map keys iterate in FileId
   * ascending order. Values iterate in name-sorted order.
   */
  readonly byFile: ReadonlyMap<FileId, ReadonlySet<string>>;
}

/**
 * Optional override map: `${fromFileId}:${toFileId}` → namespace name. Allows
 * tests (or a future enriched visitor) to drive `export * as ns` form
 * generation. Absent entries default to bare-star (`nsName === null`).
 */
export type StarAliasOverride = ReadonlyMap<string, string>;

/**
 * Generate synthetic ExportSymbols for every re-export edge in `graph`.
 *
 * Pure, synchronous, never throws.
 */
export function synthesizeStarExports(
  graph: Graph,
  aliasOverride?: StarAliasOverride,
): SynthesizedStars {
  const symbols: SyntheticStarSymbol[] = [];

  // Walk edges in canonical order. The graph builder already sorts by
  // `(from, to, kind, specifier)` so this loop produces a stable traversal.
  for (const edge of graph.edges) {
    if (!isReExportEdge(edge, graph)) continue;
    if (edge.to === ROOT_FILE_ID) continue;

    const overrideKey = `${edge.from as unknown as number}:${edge.to as unknown as number}`;
    const nsName = aliasOverride?.get(overrideKey) ?? null;
    const name = synthesizeStarSymbolName(edge.to, nsName);
    symbols.push({
      name,
      fromFile: edge.from,
      toFile: edge.to,
      nsName,
    });
  }

  // De-duplicate by `(fromFile, toFile, name)` — multiple `export *` lines
  // collapse to one synthetic symbol per (F, T).
  const seen = new Set<string>();
  const deduped: SyntheticStarSymbol[] = [];
  for (const sym of symbols) {
    const key = `${sym.fromFile as unknown as number}:${sym.toFile as unknown as number}:${sym.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(Object.freeze({ ...sym }));
  }
  deduped.sort(compareSyntheticSymbols);

  // Build the by-file index. Insert keys in ascending FileId order.
  const byFileBuckets = new Map<FileId, Set<string>>();
  for (const sym of deduped) {
    const bucket = byFileBuckets.get(sym.fromFile);
    if (bucket === undefined) {
      byFileBuckets.set(sym.fromFile, new Set([sym.name]));
    } else {
      bucket.add(sym.name);
    }
  }
  const byFile = new Map<FileId, ReadonlySet<string>>();
  const sortedFromFiles = [...byFileBuckets.keys()].sort(compareFileIds);
  for (const from of sortedFromFiles) {
    const bucket = byFileBuckets.get(from);
    if (bucket === undefined) continue;
    byFile.set(from, new Set([...bucket].sort()));
  }

  return Object.freeze({
    symbols: Object.freeze(deduped.slice()),
    byFile,
  }) satisfies SynthesizedStars;
}

/**
 * Deterministic synthetic-name composer. Pure, exported so call sites can
 * derive a name for a `(toFile, nsName)` pair without re-running the engine.
 */
export function synthesizeStarSymbolName(toFile: FileId, nsName: string | null): string {
  const idStr = String(toFile as unknown as number);
  if (nsName === null) {
    return `__star_${idStr}__`;
  }
  return `__star_${idStr}_as_${nsName}__`;
}

/**
 * Predicate — `true` when `name` matches the synthetic-star naming convention.
 * Used by reporters to filter synthetic symbols out of user-facing output.
 */
export function isSyntheticStarSymbol(name: string): boolean {
  return name.startsWith('__star_') && name.endsWith('__');
}

function compareSyntheticSymbols(a: SyntheticStarSymbol, b: SyntheticStarSymbol): number {
  const fromDelta = compareFileIds(a.fromFile, b.fromFile);
  if (fromDelta !== 0) return fromDelta;
  const toDelta = compareFileIds(a.toFile, b.toFile);
  if (toDelta !== 0) return toDelta;
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}
