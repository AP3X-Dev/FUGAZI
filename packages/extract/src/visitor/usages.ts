/**
 * usages.ts — visitor handler for identifier / JSX / decorator references.
 *
 * Emits one `Usage` per:
 *   - bare `Identifier` reference (kind `'identifier'`)
 *   - `Identifier` appearing as the `object` of a `MemberExpression` (kind `'member'`)
 *   - `JSXElement` (kind `'jsx'`) — the parser's `JSXElement.name` carries the
 *     opening-tag identifier (lowercased tag for `<div/>`, component name for
 *     `<Foo/>`, empty string for member-form `<Foo.Bar/>`)
 *   - each decorator on a `ClassDecl` (kind `'decorator'`)
 *
 * Identifiers in BINDING positions are deliberately skipped — declarators,
 * function-parameter slots, class-member name slots, enum-member name slots,
 * and the property slot of a `MemberExpression`. The orchestrator inspects
 * the parent node to disambiguate.
 *
 * The synthetic `Identifier { name: 'import' }` produced for dynamic-import
 * calls is also skipped (the dynamic-import handler already records the call).
 */

import type { ASTNode, ClassDecl, Identifier, JSXElement } from '../ast/kinds.js';
import type { Usage } from './types.js';

/**
 * Decide whether an `Identifier` node should emit a free-reference usage.
 * Returns the desired `Usage.kind`, or `null` to skip.
 *
 * Bindings (skip): function parameters, class member name slots, enum member
 * name slots, member-expression property slot, the synthetic dynamic-import
 * callee `'import'`.
 *
 * Member-expression `object` slot emits `'member'`; everything else (callee,
 * argument, expression statement child) emits `'identifier'`.
 */
function classifyIdentifier(
  node: Identifier,
  parent: ASTNode | null,
): 'identifier' | 'member' | null {
  if (node.name === '') return null;
  if (parent === null) return 'identifier';
  switch (parent.kind) {
    case 'FunctionDecl':
      // Parameter binding — skip. (The body's identifiers are walked under
      // descendant nodes, never directly under FunctionDecl.)
      return null;
    case 'ClassDecl':
      // Class member name, decorator target, or class body element. Members
      // and decorators are bindings; class body is currently empty in the
      // adapter, so anything reaching here is a binding-shaped slot. Skip.
      return null;
    case 'EnumDecl':
      // Enum member name — binding, skip.
      return null;
    case 'CallExpression':
      // Synthetic dynamic-import callee — skip; the import handler emits the
      // import record on the parent CallExpression itself.
      if (node.name === 'import' && parent.callee === node) return null;
      return 'identifier';
    case 'MemberExpression':
      // Property slot — binding, skip. Object slot — member usage.
      if (parent.property === node) return null;
      return 'member';
    default:
      return 'identifier';
  }
}

export function handleIdentifier(node: Identifier, parent: ASTNode | null, out: Usage[]): void {
  const kind = classifyIdentifier(node, parent);
  if (kind === null) return;
  out.push({ kind, name: node.name, range: node.range });
}

export function handleJSX(node: JSXElement, out: Usage[]): void {
  out.push({ kind: 'jsx', name: node.name, range: node.range });
}

export function handleDecorators(node: ClassDecl, out: Usage[]): void {
  for (const dec of node.decorators) {
    if (dec.name === '') continue;
    out.push({ kind: 'decorator', name: dec.name, range: dec.range });
  }
}
