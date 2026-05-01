/**
 * imports.ts — visitor handler for import-shaped nodes.
 *
 * Recognises three forms:
 *   - Static `ImportDecl` — `import x from './m'` and `import './m'`.
 *   - Re-export `ExportDecl` with a non-null `source` —
 *     `export { x } from './m'`, `export * from './m'`, `export { y as z } from './m'`.
 *   - Dynamic `CallExpression` whose callee is the synthetic `Identifier`
 *     with name `'import'` (the parser remaps SWC's `Import` callee node).
 *     Only resolvable when the first argument is a string `Literal`.
 */

import type { CallExpression, ExportDecl, ImportDecl } from '../ast/kinds.js';
import type { Import } from './types.js';

export function handleStaticImport(node: ImportDecl, out: Import[]): void {
  out.push({
    kind: 'static',
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
 */
export function handleDynamicImport(node: CallExpression, out: Import[]): boolean {
  if (node.callee.kind !== 'Identifier' || node.callee.name !== 'import') return false;
  const first = node.args[0];
  if (first !== undefined && first.kind === 'Literal' && typeof first.value === 'string') {
    out.push({
      kind: 'dynamic',
      source: first.value,
      resolvable: true,
      range: node.range,
    });
  } else {
    out.push({
      kind: 'dynamic',
      source: '',
      resolvable: false,
      range: node.range,
    });
  }
  return true;
}
