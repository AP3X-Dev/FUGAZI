/**
 * types.ts — Phase 3d.3 (T091) — module-graph data structures.
 *
 * The graph layer composes the path-sorted FileId mapping (Phase 3d.1) and the
 * import-specifier resolver (Phase 3d.2) with the per-file `Inventory` produced
 * by `@fugazi/extract` (Phase 3c.4). Each FileNode owns its inventory; each
 * Edge records a single import relation between two files plus the
 * `EdgeKind` classification used by downstream analyses (dead-code detection,
 * type-only pruning, runtime weight propagation).
 *
 * Determinism (NFR-1 / SC-15):
 *   - All shapes deeply readonly. Objects are `Object.freeze`d on emit.
 *   - The `edges` array is sorted by `(from, to, kind, specifier)` before the
 *     graph is frozen.
 *   - The `edgesByTarget` Map is built by iterating the sorted edges, so its
 *     keys are visited in numeric `to` order and each value array preserves
 *     the canonical edge order.
 *   - Unresolvable / external imports collapse to `to = ROOT_FILE_ID` so the
 *     reverse index still has a stable bucket for "out-of-project" reach.
 */

import type { Inventory } from '@fugazi/extract';
import type { FileId, Range } from '@fugazi/types';

/**
 * A node in the module graph. The `id` is the path-sorted FileId from
 * `assignFileIds`; `path` is the absolute POSIX path used as that id's key;
 * `inventory` is the @fugazi/extract inventory for the same file.
 */
export interface FileNode {
  readonly id: FileId;
  readonly path: string;
  readonly inventory: Inventory;
}

/**
 * Edge classification — preserved across all downstream consumers.
 *
 *   - `static`      `import x from './m'` (also re-exports — see `./build.ts`).
 *   - `type`        `import type { X } from './m'` or `import { type X }`
 *                   when every specifier is type-only.
 *   - `dynamic`     `import('./m')` (resolvable or constant-prefixed).
 *   - `require`     `require('./m')` — reserved; not yet emitted by extract.
 *   - `side-effect` `import './m'` with no specifiers — see `./edge-kinds.ts`
 *                   for the current reachability limitation.
 *   - `asset`       `new URL('./m', import.meta.url)`.
 */
export type EdgeKind = 'static' | 'type' | 'dynamic' | 'require' | 'side-effect' | 'asset';

/**
 * A single import edge in the graph.
 *
 *   - `from`        Source FileId.
 *   - `to`          Target FileId, or `ROOT_FILE_ID` when the import is
 *                   external / unresolved / not in the project file set.
 *   - `kind`        Classification (`./edge-kinds.ts`).
 *   - `specifier`   Verbatim import source (`'./m'`, `'react'`, …).
 *   - `resolvable`  `false` for external, unresolved, or non-project targets.
 *                   `true` only when the target FileId is concrete (non-root).
 *   - `loc`         Range of the import statement in `from`.
 */
export interface Edge {
  readonly from: FileId;
  readonly to: FileId;
  readonly kind: EdgeKind;
  readonly specifier: string;
  readonly resolvable: boolean;
  readonly loc: Range;
}

/**
 * The assembled, frozen graph.
 *
 *   - `files`         ReadonlyMap<FileId, FileNode>, insertion-ordered to match
 *                     the input FileNode array (callers pass path-sorted input).
 *   - `edges`         All edges, sorted by `(from, to, kind, specifier)`.
 *   - `edgesByTarget` Reverse index from `to` to its incoming edges, in the
 *                     same canonical sub-order. Targets are visited in numeric
 *                     `to` order during construction.
 */
export interface Graph {
  readonly files: ReadonlyMap<FileId, FileNode>;
  readonly edges: readonly Edge[];
  readonly edgesByTarget: ReadonlyMap<FileId, readonly Edge[]>;
}
