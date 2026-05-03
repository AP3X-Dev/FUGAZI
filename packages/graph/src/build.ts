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
 *        - `kind: 'builtin'`   → `to = ROOT_FILE_ID`, `resolvable = true`.
 *                                 Runtime built-ins (`node:fs`, `bun:test`)
 *                                 are not on disk but are not user errors;
 *                                 keeping `resolvable: true` ensures the
 *                                 unresolved-imports / unlisted-dependencies
 *                                 rules don't false-positive on them.
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

  // Phase 4f T381 — synthetic "package-init" edges for Python files.
  // Python imports run every `__init__.py` in the package chain when any
  // module inside the package is loaded. Without surfacing this, an empty
  // `pkg/__init__.py` is flagged as unused-files even when `pkg/main.py`
  // is the project entrypoint. We emit a synthetic `static` edge from
  // every Python file to its parent-package `__init__.py` (if present in
  // the project file set), and recursively to the grandparent's
  // `__init__.py`, until either the chain breaks (no `__init__.py` in the
  // ancestor dir) or we exit the project root. The edges are
  // `resolvable: true` and use the special specifier `'<package-init>'`
  // so consumers can distinguish them from explicit imports.
  for (const node of files) {
    if (!isPythonFilePath(node.path)) continue;
    let dir = parentDirPosix(node.path);
    let prevDir: string | null = null;
    while (dir !== '' && dir !== prevDir) {
      const initPath = `${dir}/__init__.py`;
      const initId = pathToFileId.get(initPath);
      if (initId !== undefined && initId !== node.id) {
        accumulated.push(
          Object.freeze({
            from: node.id,
            to: initId,
            kind: 'static' as EdgeKind,
            specifier: '<package-init>',
            resolvable: true,
            loc: node.inventory.imports[0]?.range ?? ZERO_RANGE,
          }),
        );
      } else {
        // No `__init__.py` in this directory — chain breaks (PEP 420
        // namespace packages don't carry inits, but for the unused-files
        // story we only walk while explicit inits are present).
        break;
      }
      prevDir = dir;
      dir = parentDirPosix(dir);
    }
  }

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

      // Phase 4f T381 — Python submodule promotion. For
      // `from X import Y, Z`, additionally probe `X.Y` / `X.Z` as candidate
      // submodule paths and emit an edge for each that resolves on disk.
      // Without this, `from .sub import foo` produces only the edge to
      // `pkg/sub/__init__.py` and `pkg/sub/foo.py` is wrongly flagged as
      // unused-files even though it's the actual import target. We only
      // emit when the candidate file exists in the project's FileNode set
      // — phantom edges for symbol-only imports (`from .util import HELPER`
      // where HELPER is a name defined in `util.py`'s namespace, not a
      // submodule) are silently dropped.
      if (
        importRecord.names !== undefined &&
        importRecord.names.length > 0 &&
        isPythonFilePath(node.path)
      ) {
        for (const name of importRecord.names) {
          const subSpec = importRecord.source === '' ? name : `${importRecord.source}.${name}`;
          const subTarget = resolveSubmoduleId(subSpec, node.path, ctx, pathToFileId);
          if (subTarget === null) continue;
          // Skip when the submodule resolves to the SAME file the primary
          // edge already points at (keeps determinism — no duplicate edge
          // with identical `(from, to, kind, specifier)` shape).
          if (subTarget.id === targetId.id && subSpec === importRecord.source) continue;
          accumulated.push(
            Object.freeze({
              from: node.id,
              to: subTarget.id,
              kind: edgeKind,
              specifier: subSpec,
              resolvable: subTarget.resolvable,
              loc: importRecord.range,
            }),
          );
        }
      }
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
      // Resolved on disk but outside the project file set — typically a
      // third-party module under `node_modules/` (which discovery skips).
      // Mark `resolvable: true` so the import-hygiene / unused-deps rules
      // don't false-positive: the specifier did resolve, it's just to a
      // non-project file. The edge still bucket under ROOT_FILE_ID because
      // we have no FileId for it.
      return { id: ROOT_FILE_ID, resolvable: true };
    }
    case 'builtin':
      // Runtime built-in (`node:fs`, `bun:test`, …): not on disk, but not a
      // user-facing dep either. Mark resolvable so import-hygiene /
      // unused-deps rules don't fire on them.
      return { id: ROOT_FILE_ID, resolvable: true };
    case 'external':
      // Phase 4f T381. For Python files, the resolver returns `external` ONLY
      // when the bare package head is declared in the project's manifest
      // (pyproject.toml etc) OR present in a virtualenv's site-packages. Both
      // shapes are "resolved as third-party" — parallel to TS resolving a
      // bare specifier through `node_modules/`. Marking the edge
      // `resolvable: true` keeps `unresolved-imports` from false-firing on
      // imports of `flask`, `pydantic`, etc. when those deps are listed in
      // pyproject. TS keeps the historical `resolvable: false` shape — for
      // TS, `external` means "looks like a bare module name but absent on
      // disk", which IS an unresolved-imports candidate.
      if (isPythonFilePath(fromPath)) {
        return { id: ROOT_FILE_ID, resolvable: true };
      }
      return { id: ROOT_FILE_ID, resolvable: false };
    case 'unresolved':
      return { id: ROOT_FILE_ID, resolvable: false };
  }
}

/**
 * Return `true` if `path` is a Python source file (`.py` or `.pyi`).
 */
function isPythonFilePath(path: string): boolean {
  return path.endsWith('.py') || path.endsWith('.pyi');
}

/**
 * Return the parent directory of a POSIX-shape path. Pure string op — no
 * `node:path` dependency so the same logic works on Windows-canonical
 * inputs (`C:/foo/bar` → `C:/foo`).
 */
function parentDirPosix(path: string): string {
  const slash = path.lastIndexOf('/');
  if (slash <= 0) return '';
  return path.slice(0, slash);
}

/**
 * Zero range used by synthetic package-init edges. The edge has no source
 * location (it's not an explicit import statement); we point at the first
 * import's range when one exists, but fall back to this when the file has
 * zero imports. The unused-files BFS walks edges by `(from, to)` only and
 * never inspects `loc`, so the zero-range placeholder is invisible to the
 * rule layer.
 */
const ZERO_RANGE = Object.freeze({
  start: Object.freeze({ line: 1, column: 0, byteOffset: 0 }),
  end: Object.freeze({ line: 1, column: 0, byteOffset: 0 }),
});

/**
 * Phase 4f T381 — try to resolve a Python `<source>.<name>` candidate as a
 * submodule file in the project file set. Returns the FileId + resolvable
 * flag when the candidate resolves to a project file; `null` when the
 * candidate does not resolve OR resolves to a non-project file (we never
 * emit phantom edges into ROOT_FILE_ID for the promotion path — those
 * would over-count the unresolved-imports rule).
 *
 * The candidate is run through the SAME resolver dispatch as the primary
 * import; it's the resolver's job to handle relative-vs-absolute,
 * `__init__.py` probing, etc.
 */
function resolveSubmoduleId(
  spec: string,
  fromPath: string,
  ctx: ResolverContext,
  pathToFileId: ReadonlyMap<string, FileId>,
): { readonly id: FileId; readonly resolvable: boolean } | null {
  const result = resolveSpecifier(spec, fromPath, ctx);
  if (result.kind !== 'resolved') return null;
  const id = pathToFileId.get(result.target);
  if (id === undefined) return null;
  return { id, resolvable: true };
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
