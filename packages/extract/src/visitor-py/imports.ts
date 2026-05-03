/**
 * imports.ts — Phase 4a T305 — import handlers for the Python visitor.
 *
 * Recognises:
 *   - `import x` / `import x as y` / `import x.y.z` / `import a, b`
 *   - `from x import y` / `from x import y as z` / `from x import *`
 *   - `from . import x` / `from ..foo import y` (relative imports)
 *
 * Mapping to the cross-language `Import` shape (`../visitor/types.ts`):
 *   - `kind: 'static'` for every form (rules layer T331+ may downgrade
 *     individual entries to `'type'` once T307 wires TYPE_CHECKING blocks).
 *   - `source` is the dotted module specifier:
 *       `import os.path`        → 'os.path'
 *       `from foo import bar`   → 'foo'
 *       `from .x import y`      → '.x'
 *       `from .. import z`      → '..'
 *       `from ..foo import y`   → '..foo'
 *   - `resolvable: true` always at this layer; the resolver downgrades when
 *     the target is unresolvable.
 *   - The wildcard form `from x import *` emits a single Import with
 *     `source: 'x'`; the visitor records the literal `'*'` name in
 *     `Inventory.imports[].source`-adjacent metadata via a downstream layer
 *     (T306). At v1 we surface the `*` semantics by emitting source = `<x>`
 *     and letting the rules layer detect the wildcard via the names array
 *     parsed from the inventory cache. For now the visitor's contract is
 *     "one Import record per import statement / from-clause"; specific
 *     name lists are reconstructed later.
 *
 * Phase 4a v1 deliberately collapses per-name detail: the cross-language
 * `Import` shape carries only `source`. T306 (`__all__` extraction) and
 * T307 (TYPE_CHECKING) will introduce an extension shape carrying per-name
 * data. This is intentional and parallels the TS visitor's behaviour for
 * `import { a, b } from './m'` (one Import per declaration, not per
 * specifier).
 */

import type { ImportFromStmt, ImportStmt } from '../ast/kinds-py.js';
import type { Import } from '../visitor/types.js';

export function handleImport(node: ImportStmt, out: Import[], typeOnly: boolean): void {
  // `import a, b` produces ONE Import per dotted spec. Each name in the
  // ImportStmt's `names` array is `<dotted>` or `<dotted> as <alias>` per
  // the adapter's encoding.
  for (const spec of node.names) {
    const source = parseImportSpec(spec).module;
    if (source === '') continue;
    out.push({
      kind: typeOnly ? 'type' : 'static',
      source,
      resolvable: true,
      range: node.range,
    });
  }
}

export function handleImportFrom(node: ImportFromStmt, out: Import[], typeOnly: boolean): void {
  const source = encodeFromSource(node.module, node.level);
  if (source === '' && node.level === 0) return;
  out.push({
    kind: typeOnly ? 'type' : 'static',
    source,
    resolvable: true,
    range: node.range,
  });
}

/**
 * `parseImportSpec` — read back the adapter's `<dotted>` or `<dotted> as <alias>`
 * encoding. The visitor only needs the module spec; the alias is dropped.
 */
function parseImportSpec(spec: string): { readonly module: string; readonly alias?: string } {
  const idx = spec.indexOf(' as ');
  if (idx === -1) return { module: spec };
  return { module: spec.slice(0, idx), alias: spec.slice(idx + 4) };
}

/**
 * Encode `from <module> import ...` into the cross-language `source` slot.
 * Relative imports preserve their dot prefix per Python's `ast.ImportFrom`
 * convention:
 *
 *   level=0, module='foo'    → 'foo'
 *   level=1, module=null     → '.'
 *   level=1, module='foo'    → '.foo'
 *   level=2, module='foo.bar'→ '..foo.bar'
 *   level=3, module=null     → '...'
 */
function encodeFromSource(module: string | null, level: number): string {
  let prefix = '';
  for (let i = 0; i < level; i += 1) prefix += '.';
  if (module === null || module === '') return prefix;
  return prefix + module;
}
