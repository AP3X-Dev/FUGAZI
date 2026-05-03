/**
 * declarations.ts — Phase 4a T305 + T306 + Phase 4c T331 — declaration
 * handlers for the Python visitor pass.
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
 *
 * Phase 4c T331 enrichments (Python-only): `class-decl` carries `bases`
 * (the base-class identifier names) so the rule layer can detect TypedDict
 * / Protocol subclasses; `variable-decl` from `AnnAssign` carries
 * `annotation` (the leading identifier of the annotation expression, e.g.
 * `'TypeAlias'` for `X: TypeAlias = int`) and `valueCallee` (the callee
 * identifier when the RHS is a Call, e.g. `'NewType'` for
 * `Foo = NewType('Foo', int)`). All three fields stay `undefined` for TS.
 */

import type {
  ASTNodePy,
  AnnAssign,
  Assign,
  AsyncFunctionDef,
  ClassDef,
  FunctionDef,
  PyExpression,
} from '../ast/kinds-py.js';
import type { Attribute, Decorator } from '../ast/kinds-py.js';
import type { Declaration, MemberDecoration } from '../visitor/types.js';
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
  const bases = collectBaseNames(node.bases);
  const memberDecorations = collectMemberDecorations(node);
  const decoratedMembers = memberDecorations.map((d) => d.name);
  // Phase 4f T381 — surface AnnAssign-shaped class members as the
  // `fieldMembers` set. The `unused-class-members` rule treats every name
  // in this list as framework-presumed-used (Pydantic, dataclasses, attrs,
  // SQLAlchemy declarative all use the AnnAssign idiom; their fields are
  // accessed via constructor kwargs / ORM binding, neither of which the
  // literal `.member` usage pass captures). Methods (FunctionDef /
  // AsyncFunctionDef) and untyped Assign-form members keep the existing
  // exemption logic.
  const fieldMembers = collectAnnAssignFieldNames(node);
  out.push({
    kind: 'class',
    name: node.name,
    exported: isExportedName(node.name, allList),
    range: node.range,
    members: node.members.filter((n) => n !== ''),
    ...(bases.length > 0 ? { bases } : {}),
    ...(decoratedMembers.length > 0 ? { decoratedMembers } : {}),
    ...(memberDecorations.length > 0 ? { memberDecorations } : {}),
    ...(fieldMembers.length > 0 ? { fieldMembers } : {}),
  });
}

/**
 * Phase 4f T381. Walk the class body and collect the names of class-level
 * `AnnAssign` targets (annotated attributes — the field shape used by
 * Pydantic / dataclasses / attrs / SQLAlchemy declarative). Order is
 * preserved (source order). Methods, untyped class-level assignments, and
 * non-binding statements are skipped.
 */
function collectAnnAssignFieldNames(node: ClassDef): readonly string[] {
  const out: string[] = [];
  for (const stmt of node.body) {
    if (stmt.kind !== 'AnnAssign') continue;
    if (stmt.target === '') continue;
    out.push(stmt.target);
  }
  return out;
}

/**
 * Phase 4d T346. Walk the class body and surface the dotted decorator names
 * for each decorated method. Each entry pairs the member name with the list
 * of decorator names attached to it (top-most first, matching source
 * order). Methods with no decorators are skipped. Used by
 * `unused-class-members` to apply per-plugin `usedDecorators` allowlists.
 *
 * Module-level. Nested-class members are not surfaced (parallels existing
 * `collectDecoratedMemberNames` semantics).
 */
function collectMemberDecorations(node: ClassDef): readonly MemberDecoration[] {
  const out: MemberDecoration[] = [];
  for (const stmt of node.body) {
    if (stmt.kind !== 'FunctionDef' && stmt.kind !== 'AsyncFunctionDef') continue;
    if (stmt.name === '') continue;
    if (stmt.decorators.length === 0) continue;
    const decorators: string[] = [];
    for (const dec of stmt.decorators) {
      const name = decoratorDottedName(dec);
      if (name !== '') decorators.push(name);
    }
    if (decorators.length === 0) continue;
    out.push({ name: stmt.name, decorators });
  }
  return out;
}

/**
 * Render a `Decorator` as a dotted name. Unwraps a single Call layer for
 * `@dec(...)` forms. Mirrors the renderer in `usages.ts::decoratorName` but
 * is duplicated here to keep the declaration handler self-contained — the
 * usages module operates on a different AST channel (decorator-as-usage),
 * so a shared helper would require a new module.
 */
function decoratorDottedName(dec: Decorator): string {
  let cursor: import('../ast/kinds-py.js').PyExpression = dec.expression;
  if (cursor.kind === 'Call') cursor = cursor.func;
  if (cursor.kind === 'Name') return cursor.id;
  if (cursor.kind === 'Attribute') return renderDottedAttribute(cursor);
  return '';
}

function renderDottedAttribute(node: Attribute): string {
  const parts: string[] = [];
  let cursor: import('../ast/kinds-py.js').PyExpression = node;
  while (cursor.kind === 'Attribute') {
    parts.unshift(cursor.attr);
    cursor = cursor.value;
  }
  if (cursor.kind === 'Name') {
    parts.unshift(cursor.id);
    return parts.join('.');
  }
  return '';
}

export function handleAssign(
  node: Assign,
  parent: ASTNodePy | null,
  out: Declaration[],
  allList: ReadonlySet<string> | null,
): void {
  if (!isModuleLevel(parent)) return;
  // T331: detect `Foo = NewType('Foo', int)` so the rule layer can flag
  // unused `NewType` aliases as types. `valueCallee` is the callee's
  // identifier name when the RHS is a Call, undefined otherwise.
  const callee = calleeIdentifier(node.value);
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
      ...(callee !== undefined ? { valueCallee: callee } : {}),
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
  // T331: surface the annotation's leading identifier (e.g. 'TypeAlias',
  // 'TypedDict', 'Protocol') and the value's callee (e.g. 'NewType') so
  // the rule layer can classify type-like declarations without re-walking.
  const annotation = annotationLeadingName(node.annotation);
  const callee = node.value !== undefined ? calleeIdentifier(node.value) : undefined;
  out.push({
    kind: 'variable',
    name: node.target,
    exported: isExportedName(node.target, allList),
    range: node.range,
    members: [],
    ...(annotation !== undefined ? { annotation } : {}),
    ...(callee !== undefined ? { valueCallee: callee } : {}),
  });
}

/**
 * Extract base-class identifier names from the `bases` array of a ClassDef.
 * Skips non-name expressions (e.g. `Generic[T]` surfaces as `Subscript`,
 * which we resolve to its receiver `Generic`). Order is preserved.
 */
function collectBaseNames(bases: readonly PyExpression[]): readonly string[] {
  const out: string[] = [];
  for (const b of bases) {
    const name = expressionLeadingName(b);
    if (name !== undefined) out.push(name);
  }
  return out;
}

/**
 * Walk an expression to its leading identifier. Examples:
 *   - `Foo`              → 'Foo'
 *   - `mod.Foo`          → 'Foo' (rightmost attribute name)
 *   - `Generic[T]`       → 'Generic' (subscript receiver)
 *   - `mod.Foo[T]`       → 'Foo'
 *   - non-trivial forms  → undefined
 */
function expressionLeadingName(expr: PyExpression): string | undefined {
  switch (expr.kind) {
    case 'Name':
      return expr.id !== '' ? expr.id : undefined;
    case 'Attribute':
      return expr.attr !== '' ? expr.attr : undefined;
    case 'Subscript':
      return expressionLeadingName(expr.value);
    case 'Call':
      return expressionLeadingName(expr.func);
    default:
      return undefined;
  }
}

/**
 * Annotation extraction for `X: TypeAlias = int` etc. The visitor only
 * surfaces the LEADING identifier — for `Annotated[int, "info"]` this is
 * `'Annotated'`. Sufficient for the rule layer's TypeAlias / Final / etc
 * detection.
 */
function annotationLeadingName(expr: PyExpression): string | undefined {
  return expressionLeadingName(expr);
}

/**
 * When the assignment value is a Call expression, return the callee's
 * leading identifier (`'NewType'` for `NewType('Foo', int)`,
 * `'TypeVar'` for `T = TypeVar('T')`, etc). Undefined otherwise.
 */
function calleeIdentifier(expr: PyExpression): string | undefined {
  if (expr.kind !== 'Call') return undefined;
  return expressionLeadingName(expr.func);
}
