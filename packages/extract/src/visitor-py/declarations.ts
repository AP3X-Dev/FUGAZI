/**
 * declarations.ts — Phase 4a T305 — declaration handlers for the Python
 * visitor pass.
 *
 * Recognises module-level function / class / variable shapes and appends
 * `Declaration` entries to the orchestrator's accumulator. Class-body
 * declarations are folded into `members` (parallel to the TS visitor's
 * ClassDecl handling).
 *
 * Export-flag heuristic (v1, refined by T306): module-level declarations are
 * `exported: true` UNLESS the binding name starts with `_`. T306 will
 * re-fence this against `__all__ = [...]` extraction. Underscore-leading
 * names (`_priv`, `__dunder`) emit `exported: false` regardless of `__all__`
 * — Python's de-facto privacy convention is name-prefix.
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

/**
 * `isModuleLevel` — true when the declaration's parent is the top-level
 * `PyProgram` (i.e. not nested inside a function / class body / control
 * structure). The visitor emits module-level Declarations only.
 */
export function isModuleLevel(parent: ASTNodePy | null): boolean {
  return parent !== null && parent.kind === 'PyProgram';
}

/**
 * Underscore-leading names are private by convention (Python's de-facto
 * non-public marker). T306 adds `__all__` precedence; this is the v1
 * heuristic.
 */
function isPublicName(name: string): boolean {
  return name !== '' && !name.startsWith('_');
}

export function handleFunction(
  node: FunctionDef | AsyncFunctionDef,
  parent: ASTNodePy | null,
  out: Declaration[],
): void {
  if (!isModuleLevel(parent)) return;
  if (node.name === '') return;
  out.push({
    kind: 'function',
    name: node.name,
    exported: isPublicName(node.name),
    range: node.range,
    members: [],
  });
}

export function handleClass(node: ClassDef, parent: ASTNodePy | null, out: Declaration[]): void {
  if (!isModuleLevel(parent)) return;
  if (node.name === '') return;
  out.push({
    kind: 'class',
    name: node.name,
    exported: isPublicName(node.name),
    range: node.range,
    members: node.members.filter((n) => n !== ''),
  });
}

export function handleAssign(node: Assign, parent: ASTNodePy | null, out: Declaration[]): void {
  if (!isModuleLevel(parent)) return;
  for (const target of node.targets) {
    if (target === '') continue;
    out.push({
      kind: 'variable',
      name: target,
      exported: isPublicName(target),
      range: node.range,
      members: [],
    });
  }
}

export function handleAnnAssign(
  node: AnnAssign,
  parent: ASTNodePy | null,
  out: Declaration[],
): void {
  if (!isModuleLevel(parent)) return;
  if (node.target === '') return;
  // T331 (rule layer) refines `TypeAlias` / `TypedDict` / `Protocol`
  // detection. v1 emits everything as variable-decl.
  out.push({
    kind: 'variable',
    name: node.target,
    exported: isPublicName(node.target),
    range: node.range,
    members: [],
  });
}
