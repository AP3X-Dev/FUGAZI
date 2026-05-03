/**
 * declarations.ts — Phase 4a T305 + T306 — declaration handlers for the
 * Python visitor pass.
 *
 * Recognises module-level function / class / variable shapes and appends
 * `Declaration` entries to the orchestrator's accumulator. Class-body
 * declarations are folded into `members` (parallel to the TS visitor's
 * ClassDecl handling).
 *
 * Export-flag heuristic (T306):
 *   - When the orchestrator passes a non-null `allList` (extracted from a
 *     resolvable `__all__ = [...]` / `__all__ = (...)`), a declaration is
 *     `exported: true` IFF its name appears in the Set. An empty `__all__`
 *     means nothing is exported.
 *   - When `allList` is null (no `__all__`, or non-literal forms like
 *     `__all__ = a + b`), fall back to the underscore-heuristic: names not
 *     starting with `_` are public.
 *
 * The `__all__` Set is computed once at the top of `index.ts::buildPyInventory`
 * and threaded through every handler — handlers themselves do not re-walk.
 */

import type {
  ASTNodePy,
  AnnAssign,
  Assign,
  AsyncFunctionDef,
  ClassDef,
  FunctionDef,
} from '../ast/kinds-py.js';
import type { Declaration } from '../visitor/types.js';
import { isExportedName } from './all-list.js';

/**
 * `isModuleLevel` — true when the declaration's parent is the top-level
 * `PyProgram` (i.e. not nested inside a function / class body / control
 * structure). The visitor emits module-level Declarations only.
 */
export function isModuleLevel(parent: ASTNodePy | null): boolean {
  return parent !== null && parent.kind === 'PyProgram';
}

export function handleFunction(
  node: FunctionDef | AsyncFunctionDef,
  parent: ASTNodePy | null,
  out: Declaration[],
  allList: ReadonlySet<string> | null,
): void {
  if (!isModuleLevel(parent)) return;
  if (node.name === '') return;
  out.push({
    kind: 'function',
    name: node.name,
    exported: isExportedName(node.name, allList),
    range: node.range,
    members: [],
  });
}

export function handleClass(
  node: ClassDef,
  parent: ASTNodePy | null,
  out: Declaration[],
  allList: ReadonlySet<string> | null,
): void {
  if (!isModuleLevel(parent)) return;
  if (node.name === '') return;
  out.push({
    kind: 'class',
    name: node.name,
    exported: isExportedName(node.name, allList),
    range: node.range,
    members: node.members.filter((n) => n !== ''),
  });
}

export function handleAssign(
  node: Assign,
  parent: ASTNodePy | null,
  out: Declaration[],
  allList: ReadonlySet<string> | null,
): void {
  if (!isModuleLevel(parent)) return;
  for (const target of node.targets) {
    if (target === '') continue;
    // The `__all__` assignment itself is not surfaced as a declaration —
    // it's metadata, not an exported binding.
    if (target === '__all__') continue;
    out.push({
      kind: 'variable',
      name: target,
      exported: isExportedName(target, allList),
      range: node.range,
      members: [],
    });
  }
}

export function handleAnnAssign(
  node: AnnAssign,
  parent: ASTNodePy | null,
  out: Declaration[],
  allList: ReadonlySet<string> | null,
): void {
  if (!isModuleLevel(parent)) return;
  if (node.target === '') return;
  // T331 (rule layer) refines `TypeAlias` / `TypedDict` / `Protocol`
  // detection. v1 emits everything as variable-decl.
  out.push({
    kind: 'variable',
    name: node.target,
    exported: isExportedName(node.target, allList),
    range: node.range,
    members: [],
  });
}
