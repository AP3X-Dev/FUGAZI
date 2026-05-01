/**
 * imports.ts — visitor handler for import-shaped nodes.
 *
 * Recognises five forms:
 *   - Static `ImportDecl` — `import x from './m'` and `import './m'`.
 *   - Type-only `ImportDecl` — `import type { X } from './m'` and
 *     `import { type Y } from './m'` (when every specifier is type-only).
 *     Surfaced as `kind: 'type'` so downstream consumers (tree-shake reporter,
 *     unused-deps analysis, IsolatedModules-aware tooling) can skip them when
 *     building the runtime module graph.
 *   - Re-export `ExportDecl` with a non-null `source` —
 *     `export { x } from './m'`, `export * from './m'`, `export { y as z } from './m'`.
 *   - Dynamic `CallExpression` whose callee is the synthetic `Identifier`
 *     with name `'import'` (the parser remaps SWC's `Import` callee node).
 *     Argument-shape classification is delegated to `./dynamic.ts`.
 *   - Asset `NewExpression` matching `new URL(literal, import.meta.url)` —
 *     handled by the orchestrator via `../asset-url.ts`.
 *
 * Type-only classification policy (option (b) per Phase 3c.4 Dispatch C-2):
 *   The whole import is flagged `typeOnly` ONLY when EITHER (i) the declaration
 *   itself is a `import type { ... }` (SWC sets `typeOnly: true` on the
 *   declaration), OR (ii) every specifier of a normal `import { ... }` carries
 *   `isTypeOnly: true`. Mixed imports (`import { Foo, type Bar } from './m'`)
 *   stay `kind: 'static'` because the runtime specifier `Foo` keeps the
 *   binding live. This is more accurate than option (a) (any-specifier-flagged)
 *   at the cost of a single extra branch in the parser adapter.
 */

import type { CallExpression, ExportDecl, ImportDecl } from '../ast/kinds.js';
import { classifyDynamicImport } from './dynamic.js';
import type { Import } from './types.js';

export function handleStaticImport(node: ImportDecl, out: Import[]): void {
  out.push({
    kind: node.typeOnly === true ? 'type' : 'static',
    source: node.source,
    resolvable: true,
    range: node.range,
  });
}

export function handleReExport(node: ExportDecl, out: Import[]): void {
  if (node.source === null) return;
  out.push({
    kind: 'reexport',
    source: node.source,
    resolvable: true,
    range: node.range,
  });
}

/**
 * Returns true when `node` matches the dynamic-import shape and consumes the
 * call (a dynamic-import record is appended). The orchestrator skips emitting
 * a generic identifier-usage for the synthetic `'import'` callee in this case.
 *
 * Argument-shape inspection is delegated to `classifyDynamicImport` in
 * `./dynamic.ts`. The mapping from shape to `Import` record:
 *
 *   'literal'      → resolvable: true,  source: <verbatim>
 *   'template'     → resolvable: false, source: <constant prefix> (may be '')
 *   'unresolvable' → resolvable: false, source: ''
 */
export function handleDynamicImport(node: CallExpression, out: Import[]): boolean {
  if (node.callee.kind !== 'Identifier' || node.callee.name !== 'import') return false;
  const shape = classifyDynamicImport(node);
  switch (shape.kind) {
    case 'literal':
      out.push({
        kind: 'dynamic',
        source: shape.source,
        resolvable: true,
        range: node.range,
      });
      return true;
    case 'template':
      out.push({
        kind: 'dynamic',
        source: shape.source,
        resolvable: false,
        range: node.range,
      });
      return true;
    case 'unresolvable':
      out.push({
        kind: 'dynamic',
        source: '',
        resolvable: false,
        range: node.range,
      });
      return true;
  }
}
