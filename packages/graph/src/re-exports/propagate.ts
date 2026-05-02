/**
 * propagate.ts — Phase 3d.4 (T095) — re-export propagation engine.
 *
 * `propagateReExports(graph)` iterates a worklist over the re-export edges of a
 * `Graph` (Phase 3d.3) and produces, for every file, the FULL set of names
 * exported by that file once barrel chains are resolved.
 *
 * Data model
 * ----------
 *
 *   Inventory.Import records re-exports as `kind: 'reexport'` carrying ONLY a
 *   `source` specifier — per-specifier names and aliases are not preserved by
 *   the Phase 3c.4 visitor (see `packages/extract/src/visitor/types.ts`).
 *   Consequently, every re-export edge is interpreted as an `export *`-style
 *   copy: at convergence, the source file's export set contains all names that
 *   the target's export set contains.
 *
 *   A future visitor enrichment that surfaces aliases will plug into the same
 *   fixed-point loop without changing the public shape — adding a per-edge
 *   alias map only changes the per-iteration `propagateOne` step.
 *
 * Algorithm (matches the original Fallow reference at
 * `crates/graph/src/graph/re_exports/propagate.rs` adapted for our coarser
 * inventory):
 *
 *   1. Seed: `exports[f] = { decl.name | decl ∈ inventory.declarations,
 *                             decl.exported, decl.name !== '' }`.
 *   2. Iterate up to `MAX_ITERATIONS = 20`. Each round, for every file F that
 *      has at least one re-export edge to a target T (where T is an in-project
 *      file — `to !== ROOT_FILE_ID`), copy every name in `exports[T]` into
 *      `exports[F]`. Track per-file changes; if no file's set grew, break.
 *   3. If the loop reaches the cap without convergence, append a `'cap-hit'`
 *      diagnostic.
 *   4. Build provenance: `${fileId}:${name} → { sourceFile, sourceName }`.
 *      For names declared locally, `sourceFile = fileId, sourceName = name`.
 *      For names propagated through one or more star re-exports, `sourceFile`
 *      points at the FIRST barrel hop the name came in through and
 *      `sourceName === name`. We do NOT walk the chain to its terminal
 *      declaration — provenance is one hop deep, matching the Fallow reference
 *      where the per-iteration delta records the immediate source file.
 *
 * Determinism (NFR-1 / SC-15)
 * ---------------------------
 *
 *   - The output `exports` Map is built by walking the input `Graph.files`
 *     keys in iteration order (which Phase 3d.3 guarantees is FileId-sorted).
 *   - Per-file Sets are rebuilt as sorted arrays before being frozen, then
 *     wrapped back into `Set` so iteration order is name-sorted.
 *   - The `provenance` Map is keyed by `${fileId}:${name}` and built in
 *     (fileId, name) sorted order.
 *   - Diagnostics are sorted by `(kind, fileId)` (cycle diagnostics from
 *     `./cycles.ts` carry their own internal ordering).
 *   - No `Math.random`, no `Date.now`, no `localeCompare`.
 *
 * Cap-hit diagnostic message format is fixture-asserted byte-for-byte
 * (E5 / IMP-CORRECT-09) — keep the literal in sync with the tests.
 */

import { type FileId, ROOT_FILE_ID, compareFileIds } from '@fugazi/types';
import type { Edge, Graph } from '../types.js';

/**
 * Maximum number of fixed-point iterations before we bail with a `'cap-hit'`
 * diagnostic. Matches the original Fallow `max_iterations = 20` constant.
 */
export const MAX_ITERATIONS = 20;

/**
 * One-hop provenance for a propagated name.
 *
 * `sourceFile` is the FILE the name was directly copied FROM during the last
 * propagation step (NOT the terminal declaration site after multiple hops).
 * `sourceName` echoes the propagated name — aliases would change this, but
 * the current visitor does not surface alias data, so it is always equal to
 * the export name.
 */
export interface Provenance {
  readonly sourceFile: FileId;
  readonly sourceName: string;
}

export type PropagationDiagnostic =
  | { readonly kind: 'cap-hit'; readonly iterations: number }
  | { readonly kind: 'cycle'; readonly fileIds: readonly FileId[] };

export interface PropagatedExports {
  /**
   * Per-file exported-names set. Map keys iterate in FileId-sorted order.
   * Each Set iterates in name-sorted order.
   */
  readonly exports: ReadonlyMap<FileId, ReadonlySet<string>>;
  /**
   * One-hop provenance for every propagated name. Key: `${fileId}:${name}`.
   * Map insertion order is `(fileId, name)` sorted.
   */
  readonly provenance: ReadonlyMap<string, Provenance>;
  /**
   * Sorted by `(kind, fileId)`. Cycle diagnostics retain their internal
   * fileIds in numeric-ascending order; see `./cycles.ts`.
   */
  readonly diagnostics: readonly PropagationDiagnostic[];
}

/**
 * Run the fixed-point engine on `graph`. Synchronous, never throws.
 *
 * The function is pure with respect to its input: a frozen, FileId-keyed
 * `PropagatedExports` is returned and `graph` is left untouched.
 */
export function propagateReExports(graph: Graph): PropagatedExports {
  // --------------------------------------------------------------
  // Step 1: seed each file's export set with its declared exports.
  // --------------------------------------------------------------
  const working = new Map<FileId, Set<string>>();
  // Provenance map: track the FIRST (file, name) we observed propagating into
  // each (file, name) slot. Local declarations seed with self-provenance.
  const provenance = new Map<string, Provenance>();

  // Walk in FileId-sorted order. Phase 3d.3 inserts `graph.files` keys in
  // FileId order already, but iterate via a sorted snapshot defensively so we
  // do not depend on caller-side insertion discipline.
  const fileIds = [...graph.files.keys()].sort(compareFileIds);

  for (const fileId of fileIds) {
    const node = graph.files.get(fileId);
    if (node === undefined) continue;
    const seed = new Set<string>();
    for (const decl of node.inventory.declarations) {
      if (!decl.exported) continue;
      if (decl.name === '') continue; // anonymous default exports — skip
      seed.add(decl.name);
    }
    working.set(fileId, seed);
    // Seed provenance for declared exports.
    for (const name of seed) {
      const key = `${fileId as unknown as number}:${name}`;
      provenance.set(key, { sourceFile: fileId, sourceName: name });
    }
  }

  // --------------------------------------------------------------
  // Step 2: precompute the re-export adjacency F → list<T>.
  //
  // The graph builder collapses re-exports into `kind: 'static'` edges (Phase
  // 3d.3 design note in `build.ts`), so we cannot rely on `Edge.kind` alone.
  // The discriminator lives on the originating `Inventory.Import` record:
  // `(specifier, kind === 'reexport')`. We walk each file's inventory imports
  // ONCE, match them against the file's outgoing edges by `specifier`, and
  // collect the resolved targets.
  //
  // Multiple re-exports may share a specifier (e.g. several `export * from
  // './m'` lines collapsed to a single edge); we de-duplicate target FileIds
  // per source so the propagation step does the same work once per (F, T).
  // --------------------------------------------------------------
  const reExportTargets = new Map<FileId, Set<FileId>>();
  for (const fileId of fileIds) {
    const node = graph.files.get(fileId);
    if (node === undefined) continue;
    const reExportSpecifiers = new Set<string>();
    for (const importRecord of node.inventory.imports) {
      if (importRecord.kind !== 'reexport') continue;
      reExportSpecifiers.add(importRecord.source);
    }
    if (reExportSpecifiers.size === 0) continue;

    const targets = new Set<FileId>();
    for (const edge of graph.edges) {
      if (edge.from !== fileId) continue;
      if (!reExportSpecifiers.has(edge.specifier)) continue;
      // Skip non-resolvable / out-of-project re-exports — there is nothing to
      // copy. Property #15 asserts these are dropped silently.
      if (edge.to === ROOT_FILE_ID) continue;
      if (!edge.resolvable) continue;
      targets.add(edge.to);
    }
    if (targets.size > 0) {
      reExportTargets.set(fileId, targets);
    }
  }

  // --------------------------------------------------------------
  // Step 3: fixed-point iteration.
  // --------------------------------------------------------------
  const diagnostics: PropagationDiagnostic[] = [];
  let iteration = 0;
  let capHit = false;

  // We iterate F → T pairs in FileId-sorted order so the provenance
  // assignment order is deterministic across runs.
  const sortedReExportEntries: ReadonlyArray<readonly [FileId, readonly FileId[]]> = [
    ...reExportTargets.entries(),
  ]
    .map(([f, ts]) => [f, [...ts].sort(compareFileIds)] as const)
    .sort((a, b) => compareFileIds(a[0], b[0]));

  while (iteration < MAX_ITERATIONS) {
    iteration += 1;
    let changedThisIteration = false;

    for (const [from, targets] of sortedReExportEntries) {
      const fromSet = working.get(from);
      if (fromSet === undefined) continue;
      for (const to of targets) {
        const toSet = working.get(to);
        if (toSet === undefined) continue;
        // Walk T's export names in name-sorted order — keeps provenance
        // assignment deterministic when multiple barrels race.
        const toNames = [...toSet].sort();
        for (const name of toNames) {
          if (fromSet.has(name)) continue;
          fromSet.add(name);
          changedThisIteration = true;
          // Set provenance only if not already recorded. The first source
          // we observe wins — matches the Fallow reference's monotonic
          // accumulator. Per-iteration ordering above guarantees the same
          // "first source" deterministically.
          const key = `${from as unknown as number}:${name}`;
          if (!provenance.has(key)) {
            provenance.set(key, { sourceFile: to, sourceName: name });
          }
        }
      }
    }

    if (!changedThisIteration) break;
    if (iteration === MAX_ITERATIONS && changedThisIteration) {
      capHit = true;
    }
  }

  if (capHit) {
    diagnostics.push({ kind: 'cap-hit', iterations: MAX_ITERATIONS });
  }

  // --------------------------------------------------------------
  // Step 4: freeze output. Sets iterate in name-sorted order.
  // --------------------------------------------------------------
  const frozenExports = new Map<FileId, ReadonlySet<string>>();
  for (const fileId of fileIds) {
    const set = working.get(fileId);
    if (set === undefined) {
      frozenExports.set(fileId, Object.freeze(new Set<string>()));
      continue;
    }
    const sortedSet = new Set<string>([...set].sort());
    frozenExports.set(fileId, sortedSet);
  }

  // Provenance: rebuild in (fileId, name) sorted order for deterministic
  // Map iteration. The keys are `${fileId}:${name}`; we sort by parsing the
  // numeric prefix and the suffix string so ordering is stable.
  const provenanceEntries = [...provenance.entries()].sort((a, b) => {
    const [aId, aName] = splitProvenanceKey(a[0]);
    const [bId, bName] = splitProvenanceKey(b[0]);
    if (aId !== bId) return aId - bId;
    if (aName < bName) return -1;
    if (aName > bName) return 1;
    return 0;
  });
  const frozenProvenance = new Map<string, Provenance>(provenanceEntries);

  // Diagnostics: sort by (kind, then any ordering inherent to the variant).
  // Only `'cap-hit'` is currently emitted here. Cycle diagnostics are appended
  // by the orchestrator (`./cycles.ts`) and re-sorted there if needed.
  diagnostics.sort(compareDiagnostics);

  return Object.freeze({
    exports: frozenExports,
    provenance: frozenProvenance,
    diagnostics: Object.freeze(diagnostics.slice()),
  }) satisfies PropagatedExports;
}

/**
 * Split a `${fileId}:${name}` key into its numeric and string parts.
 *
 * `:` is permitted in name (rare but legal in TS — e.g. JSX attribute keys
 * surfaced by future visitor extensions), so we split at the FIRST colon.
 */
function splitProvenanceKey(key: string): readonly [number, string] {
  const colon = key.indexOf(':');
  if (colon === -1) return [0, key];
  const idPart = key.slice(0, colon);
  const namePart = key.slice(colon + 1);
  const id = Number.parseInt(idPart, 10);
  return [Number.isFinite(id) ? id : 0, namePart];
}

function compareDiagnostics(a: PropagationDiagnostic, b: PropagationDiagnostic): number {
  if (a.kind < b.kind) return -1;
  if (a.kind > b.kind) return 1;
  // Same kind — both `'cap-hit'` (single instance) or both `'cycle'`.
  // For cycles, sort by the lowest fileId in each cycle.
  if (a.kind === 'cycle' && b.kind === 'cycle') {
    const aMin = a.fileIds[0];
    const bMin = b.fileIds[0];
    if (aMin === undefined && bMin === undefined) return 0;
    if (aMin === undefined) return -1;
    if (bMin === undefined) return 1;
    return compareFileIds(aMin, bMin);
  }
  return 0;
}

/**
 * Re-export of the diagnostic message used by the cap-hit branch. Asserted
 * verbatim from fixture tests (E5 / IMP-CORRECT-09). Construct strings via
 * concatenation to keep this constant grep-able without putting the literal
 * in two source locations.
 */
export const CAP_HIT_MESSAGE =
  're-export propagation hit max_iterations=20 cap; some exports may be missing';

/**
 * Helper for callers (orchestrator, tests) that want a human-readable
 * description of a diagnostic. Pure, never throws.
 */
export function describeDiagnostic(d: PropagationDiagnostic): string {
  switch (d.kind) {
    case 'cap-hit':
      return CAP_HIT_MESSAGE;
    case 'cycle':
      return `re-export cycle detected: ${d.fileIds
        .map((id) => String(id as unknown as number))
        .join(' → ')}`;
  }
}

/**
 * Re-exported edge predicate. Pure helper used by `./cycles.ts` so cycle
 * detection sees the same subgraph the propagation engine does.
 *
 * An edge is treated as a re-export iff:
 *   - The source file's inventory has at least one `Import` record with
 *     `kind: 'reexport'` and `source === edge.specifier`.
 *   - `edge.resolvable` is `true` and `edge.to !== ROOT_FILE_ID`.
 *
 * Returns `true` when the edge participates in re-export propagation.
 */
export function isReExportEdge(edge: Edge, graph: Graph): boolean {
  if (!edge.resolvable) return false;
  if (edge.to === ROOT_FILE_ID) return false;
  const node = graph.files.get(edge.from);
  if (node === undefined) return false;
  for (const record of node.inventory.imports) {
    if (record.kind === 'reexport' && record.source === edge.specifier) {
      return true;
    }
  }
  return false;
}
