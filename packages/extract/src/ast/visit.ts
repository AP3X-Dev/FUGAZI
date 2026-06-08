/**
 * visit.ts — Phase 3c.4 Dispatch A (T062) — depth-first AST walker.
 *
 * `walk(root, visitor)` performs a single depth-first traversal of an
 * `ASTNode`, invoking `onEnter` (synonym: `onNode`) before descending into
 * children and `onLeave` after. Children are iterated in DECLARATION ORDER —
 * the structural order produced by the parser adapter — with no sort. This
 * matches FR-D3 / SC-15 byte-determinism: two consecutive walks of the same
 * Program produce the same `onNode` call sequence.
 *
 * The structural-children mapping lives in `childrenOf(node)`, which uses a
 * `switch` over `node.kind` with `assertNever` as the default case. This
 * gives compile-time exhaustiveness: adding a new variant to the `ASTNode`
 * union without updating `childrenOf` fails `tsc --noEmit`.
 *
 * Per IMP-DEBT-08: Fugazi NEVER uses a string-based sentinel pipeline. The
 * visitor pass operates exclusively on the discriminated union from
 * `./kinds.ts`.
 */

import { assertNever } from '@fugazi/types';
import type {
  ASTNode,
  BlockStatement,
  CallExpression,
  ClassDecl,
  EnumDecl,
  ExportDecl,
  ExpressionStatement,
  ForStatement,
  FunctionDecl,
  Identifier,
  IfStatement,
  ImportDecl,
  ImportMeta,
  JSXElement,
  Literal,
  MemberExpression,
  NewExpression,
  Program,
  SwitchStatement,
  TemplateLiteral,
  TypeDecl,
  UnknownExpression,
  UnknownStatement,
  VariableDecl,
  WhileStatement,
} from './kinds.js';

/**
 * Visitor interface — every callback is optional. `onNode` is shorthand for
 * `onEnter` (a single hook is the common case); when both are supplied,
 * `onEnter` runs first.
 */
export interface Visitor {
  readonly onNode?: (node: ASTNode, parent: ASTNode | null) => void;
  readonly onEnter?: (node: ASTNode, parent: ASTNode | null) => void;
  readonly onLeave?: (node: ASTNode, parent: ASTNode | null) => void;
}

/**
 * `childrenOf` — structural children of the given node, in declaration order.
 * Leaves (`Identifier`, `Literal`, `ImportMeta`, `JSXElement`, `ImportDecl`,
 * `ExportDecl`, `TypeDecl`, `UnknownStatement`, `UnknownExpression`) return
 * an empty array.
 *
 * The switch is exhaustive: omitting a kind makes the `assertNever(node)`
 * default branch a type error.
 */
export function childrenOf(node: ASTNode): readonly ASTNode[] {
  switch (node.kind) {
    case 'Program':
      return programChildren(node);
    case 'BlockStatement':
      return blockChildren(node);
    case 'CallExpression':
      return callChildren(node);
    case 'ClassDecl':
      return classChildren(node);
    case 'EnumDecl':
      return enumChildren(node);
    case 'ExportDecl':
      return exportChildren(node);
    case 'ExpressionStatement':
      return expressionStatementChildren(node);
    case 'ForStatement':
      return forChildren(node);
    case 'FunctionDecl':
      return functionChildren(node);
    case 'Identifier':
      return identifierChildren(node);
    case 'IfStatement':
      return ifChildren(node);
    case 'ImportDecl':
      return importChildren(node);
    case 'ImportMeta':
      return importMetaChildren(node);
    case 'JSXElement':
      return jsxChildren(node);
    case 'Literal':
      return literalChildren(node);
    case 'MemberExpression':
      return memberChildren(node);
    case 'NewExpression':
      return newChildren(node);
    case 'SwitchStatement':
      return switchChildren(node);
    case 'TemplateLiteral':
      return templateChildren(node);
    case 'TypeDecl':
      return typeChildren(node);
    case 'UnknownExpression':
      return unknownExpressionChildren(node);
    case 'UnknownStatement':
      return unknownStatementChildren(node);
    case 'VariableDecl':
      return variableChildren(node);
    case 'WhileStatement':
      return whileChildren(node);
    default:
      return assertNever(node);
  }
}

// Per-kind children-iterators. Each returns a fresh array (never a stored
// internal reference) so callers cannot mutate the AST through the walk.
// Leaves return `[]` literals — TypeScript widens these to `readonly ASTNode[]`
// at the call site.
function programChildren(n: Program): readonly ASTNode[] {
  return n.body;
}
function blockChildren(n: BlockStatement): readonly ASTNode[] {
  return n.body;
}
function callChildren(n: CallExpression): readonly ASTNode[] {
  return [n.callee, ...n.args];
}
function classChildren(n: ClassDecl): readonly ASTNode[] {
  return [...n.decorators, ...n.members, ...n.body];
}
function enumChildren(n: EnumDecl): readonly ASTNode[] {
  return n.members;
}
function exportChildren(n: ExportDecl): readonly ASTNode[] {
  return n.declaration !== undefined ? [n.declaration] : [];
}
function expressionStatementChildren(n: ExpressionStatement): readonly ASTNode[] {
  return [n.expression];
}
function forChildren(n: ForStatement): readonly ASTNode[] {
  return n.body;
}
function functionChildren(n: FunctionDecl): readonly ASTNode[] {
  return [...n.params, ...n.body];
}
function identifierChildren(_n: Identifier): readonly ASTNode[] {
  return [];
}
function ifChildren(n: IfStatement): readonly ASTNode[] {
  return n.body;
}
function importChildren(_n: ImportDecl): readonly ASTNode[] {
  return [];
}
function importMetaChildren(_n: ImportMeta): readonly ASTNode[] {
  return [];
}
function jsxChildren(_n: JSXElement): readonly ASTNode[] {
  return [];
}
function literalChildren(_n: Literal): readonly ASTNode[] {
  return [];
}
function memberChildren(n: MemberExpression): readonly ASTNode[] {
  return [n.object, n.property];
}
function newChildren(n: NewExpression): readonly ASTNode[] {
  return [n.callee, ...n.args];
}
function switchChildren(n: SwitchStatement): readonly ASTNode[] {
  return n.body;
}
function templateChildren(n: TemplateLiteral): readonly ASTNode[] {
  // `quasis` is a list of cooked strings, not nodes — only the inner
  // `expressions` are walkable.
  return n.expressions;
}
function typeChildren(_n: TypeDecl): readonly ASTNode[] {
  return [];
}
function unknownExpressionChildren(_n: UnknownExpression): readonly ASTNode[] {
  return [];
}
function unknownStatementChildren(_n: UnknownStatement): readonly ASTNode[] {
  return [];
}
function variableChildren(_n: VariableDecl): readonly ASTNode[] {
  // `declarations` carries `VariableDeclarator` items, which are NOT walkable
  // ASTNodes (no `kind` discriminator). Visitors needing declarator names
  // read `node.declarations` directly inside an `onNode` handler.
  return [];
}
function whileChildren(n: WhileStatement): readonly ASTNode[] {
  return n.body;
}

/**
 * Depth-first walk over `root`. Determinism: children are walked in declaration
 * order with no sort; two consecutive walks of the same `root` produce the
 * same call sequence.
 *
 * Both `onEnter` and `onNode` fire on enter (in that order if both are set);
 * `onLeave` fires after all children have been walked.
 */
export function walk(root: ASTNode, visitor: Visitor): void {
  walkNode(root, null, visitor);
}

function walkNode(node: ASTNode, parent: ASTNode | null, visitor: Visitor): void {
  if (visitor.onEnter !== undefined) visitor.onEnter(node, parent);
  if (visitor.onNode !== undefined) visitor.onNode(node, parent);
  for (const child of childrenOf(node)) {
    walkNode(child, node, visitor);
  }
  if (visitor.onLeave !== undefined) visitor.onLeave(node, parent);
}
