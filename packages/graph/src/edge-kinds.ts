/**
 * edge-kinds.ts — Phase 3d.3 (T093) — Inventory.Import → EdgeKind classifier.
 *
 * Maps an `Import` record from `@fugazi/extract` to the graph-layer `EdgeKind`.
 * The mapping is intentionally one-way and exhaustive: TypeScript checks the
 * `switch` against every member of `Import['kind']` and the `default` branch
 * funnels into `assertNever` so adding a new ImportKind upstream becomes a
 * compile error here.
 *
 * Mapping rules (matches `./build.ts` doc):
 *
 *   ImportKind   →  EdgeKind
 *   ---------       --------
 *   'static'     →  'static'   (regular runtime imports)
 *   'type'       →  'type'     (declaration-level or all-specifier type-only)
 *   'dynamic'    →  'dynamic'  (`import(...)` — resolvable or constant prefix)
 *   'asset'      →  'asset'    (`new URL(literal, import.meta.url)`)
 *   'reexport'   →  'static'   (re-exports flow through propagation in 3d.4;
 *                               at the graph layer they are indistinguishable
 *                               from regular static imports — see ./build.ts)
 *
 * `'side-effect'` and `'require'` are reserved EdgeKinds that the current
 * inventory pipeline does NOT yet emit:
 *
 *   - `'side-effect'`: surfaces when `import './m'` carries no specifiers.
 *     The current `Inventory.Import` shape does not preserve specifier-binding
 *     information, so the visitor cannot distinguish a side-effect import
 *     from a default/named import. A future visitor extension that records
 *     `ImportDeclaration.specifiers.length === 0` will close this gap. Until
 *     then, side-effect imports are emitted as `'static'` edges and can still
 *     be reached / counted, just not specifically labeled. The classifier
 *     accepts a synthetic flag-bearing record so unit tests can assert the
 *     branch survives the switch (see `./__tests__/edge-kinds.test.ts`).
 *
 *   - `'require'`: surfaces when CommonJS `require('./m')` is recognised by
 *     a future CJS visitor pass. Out of scope for the inventory pipeline as
 *     of Phase 3c.4 — preserved as an `EdgeKind` so downstream analyses can
 *     branch on it without churn when the visitor lands.
 */

import type { Import } from '@fugazi/extract';
import { assertNever } from '@fugazi/types';
import type { EdgeKind } from './types.js';

/**
 * Classify an inventory `Import` record into its graph-layer `EdgeKind`.
 *
 * Pure, synchronous, never throws on a well-typed input — the only `throw`
 * path is the `assertNever` runtime fallback when an unknown discriminant
 * slips through (it cannot under `tsc --noEmit`).
 */
export function classifyEdgeKind(record: Import): EdgeKind {
  switch (record.kind) {
    case 'static':
      return 'static';
    case 'type':
      return 'type';
    case 'dynamic':
      return 'dynamic';
    case 'asset':
      return 'asset';
    case 'reexport':
      return 'static';
    default:
      return assertNever(record.kind);
  }
}
