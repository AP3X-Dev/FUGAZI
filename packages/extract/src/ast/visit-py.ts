/**
 * visit-py.ts — Phase 4a T303 — depth-first Python AST walker.
 *
 * `walkPy(root, visitor)` performs a single depth-first traversal of an
 * `ASTNodePy`, invoking `onEnter` (synonym: `onNode`) before descending into
 * children and `onLeave` after. Children are iterated in DECLARATION ORDER —
 * the structural order produced by the parser adapter (T304) — with no sort.
 * This matches FR-D3 / SC-15 byte-determinism: two consecutive walks of the
 * same `PyProgram` produce the same `onNode` call sequence.
 *
 * Mirrors `./visit.ts` (the TS walker) field-for-field. The structural-children
 * mapping lives in `childrenOfPy(node)`, which uses a `switch` over `node.kind`
 * with `assertNever` as the default case. This gives compile-time
 * exhaustiveness: adding a new variant to the `ASTNodePy` union without
 * updating `childrenOfPy` fails `tsc --noEmit`.
 *
 * Per IMP-DEBT-08: Fugazi NEVER reintroduces the original Fallow's
 * string-based sentinel pipeline. The Python visitor pass operates exclusively
 * on the discriminated union from `./kinds-py.ts`.
 */

import { assertNever } from '@fugazi/types';
import type {
  ASTNodePy,
  AnnAssign,
  Assign,
  AsyncFunctionDef,
  Attribute,
  AugAssign,
  Await,
  BinOp,
  BoolOp,
  Break,
  Call,
  ClassDef,
  Comprehension,
  Conditional,
  Constant,
  Continue,
  Decorator,
  Dict,
  ExpressionStmt,
  FString,
  ForStmt,
  FunctionDef,
  IfStmt,
  ImportFromStmt,
  ImportStmt,
  Lambda,
  List,
  MatchStmt,
  Name,
  Pass,
  PyProgram,
  Set as PySet,
  RaiseStmt,
  ReturnStmt,
  Starred,
  Subscript,
  TryStmt,
  Tuple,
  UnaryOp,
  UnknownExpression,
  UnknownStatement,
  Walrus,
  WhileStmt,
  WithStmt,
  Yield,
  YieldStmt,
} from './kinds-py.js';

/**
 * Visitor interface — every callback is optional. `onNode` is shorthand for
 * `onEnter` (a single hook is the common case); when both are supplied,
 * `onEnter` runs first.
 */
export interface PyVisitor {
  readonly onNode?: (node: ASTNodePy, parent: ASTNodePy | null) => void;
  readonly onEnter?: (node: ASTNodePy, parent: ASTNodePy | null) => void;
  readonly onLeave?: (node: ASTNodePy, parent: ASTNodePy | null) => void;
}

/**
 * `childrenOfPy` — structural children of the given Python node, in
 * declaration order. Leaves (`Name`, `Constant`, `Pass`, `Break`, `Continue`,
 * `ImportStmt`, `ImportFromStmt`, `UnknownStatement`, `UnknownExpression`)
 * return an empty array.
 *
 * The switch is exhaustive: omitting a kind makes the `assertNever(node)`
 * default branch a type error.
 */
export function childrenOfPy(node: ASTNodePy): readonly ASTNodePy[] {
  switch (node.kind) {
    case 'PyProgram':
      return programChildren(node);
    // Statements
    case 'AnnAssign':
      return annAssignChildren(node);
    case 'Assign':
      return assignChildren(node);
    case 'AsyncFunctionDef':
      return asyncFunctionChildren(node);
    case 'AugAssign':
      return augAssignChildren(node);
    case 'Break':
      return breakChildren(node);
    case 'ClassDef':
      return classChildren(node);
    case 'Continue':
      return continueChildren(node);
    case 'ExpressionStmt':
      return expressionStmtChildren(node);
    case 'ForStmt':
      return forChildren(node);
    case 'FunctionDef':
      return functionChildren(node);
    case 'IfStmt':
      return ifChildren(node);
    case 'ImportFromStmt':
      return importFromChildren(node);
    case 'ImportStmt':
      return importChildren(node);
    case 'MatchStmt':
      return matchChildren(node);
    case 'Pass':
      return passChildren(node);
    case 'RaiseStmt':
      return raiseChildren(node);
    case 'ReturnStmt':
      return returnChildren(node);
    case 'TryStmt':
      return tryChildren(node);
    case 'UnknownStatement':
      return unknownStatementChildren(node);
    case 'WhileStmt':
      return whileChildren(node);
    case 'WithStmt':
      return withChildren(node);
    case 'YieldStmt':
      return yieldStmtChildren(node);
    // Expressions
    case 'Attribute':
      return attributeChildren(node);
    case 'Await':
      return awaitChildren(node);
    case 'BinOp':
      return binOpChildren(node);
    case 'BoolOp':
      return boolOpChildren(node);
    case 'Call':
      return callChildren(node);
    case 'Comprehension':
      return comprehensionChildren(node);
    case 'Conditional':
      return conditionalChildren(node);
    case 'Constant':
      return constantChildren(node);
    case 'Decorator':
      return decoratorChildren(node);
    case 'Dict':
      return dictChildren(node);
    case 'FString':
      return fstringChildren(node);
    case 'Lambda':
      return lambdaChildren(node);
    case 'List':
      return listChildren(node);
    case 'Name':
      return nameChildren(node);
    case 'Set':
      return setChildren(node);
    case 'Starred':
      return starredChildren(node);
    case 'Subscript':
      return subscriptChildren(node);
    case 'Tuple':
      return tupleChildren(node);
    case 'UnaryOp':
      return unaryOpChildren(node);
    case 'UnknownExpression':
      return unknownExpressionChildren(node);
    case 'Walrus':
      return walrusChildren(node);
    case 'Yield':
      return yieldChildren(node);
    default:
      return assertNever(node);
  }
}

// --------------------------------------------------------------------------
// Per-kind children-iterators. Each returns a fresh array (never a stored
// internal reference) so callers cannot mutate the AST through the walk.
// Leaves return `[]` literals — TypeScript widens these to
// `readonly ASTNodePy[]` at the call site.
// --------------------------------------------------------------------------

function programChildren(n: PyProgram): readonly ASTNodePy[] {
  return n.body;
}

// Statement children

function annAssignChildren(n: AnnAssign): readonly ASTNodePy[] {
  return n.value !== undefined ? [n.annotation, n.value] : [n.annotation];
}
function assignChildren(n: Assign): readonly ASTNodePy[] {
  return [n.value];
}
function asyncFunctionChildren(n: AsyncFunctionDef): readonly ASTNodePy[] {
  return [...n.decorators, ...n.body];
}
function augAssignChildren(n: AugAssign): readonly ASTNodePy[] {
  return [n.value];
}
function breakChildren(_n: Break): readonly ASTNodePy[] {
  return [];
}
function classChildren(n: ClassDef): readonly ASTNodePy[] {
  return [...n.decorators, ...n.bases, ...n.body];
}
function continueChildren(_n: Continue): readonly ASTNodePy[] {
  return [];
}
function expressionStmtChildren(n: ExpressionStmt): readonly ASTNodePy[] {
  return [n.expression];
}
function forChildren(n: ForStmt): readonly ASTNodePy[] {
  return [n.iter, ...n.body];
}
function functionChildren(n: FunctionDef): readonly ASTNodePy[] {
  return [...n.decorators, ...n.body];
}
function ifChildren(n: IfStmt): readonly ASTNodePy[] {
  return [n.test, ...n.body];
}
function importFromChildren(_n: ImportFromStmt): readonly ASTNodePy[] {
  return [];
}
function importChildren(_n: ImportStmt): readonly ASTNodePy[] {
  return [];
}
function matchChildren(n: MatchStmt): readonly ASTNodePy[] {
  return [n.subject, ...n.body];
}
function passChildren(_n: Pass): readonly ASTNodePy[] {
  return [];
}
function raiseChildren(n: RaiseStmt): readonly ASTNodePy[] {
  const out: ASTNodePy[] = [];
  if (n.exception !== undefined) out.push(n.exception);
  if (n.cause !== undefined) out.push(n.cause);
  return out;
}
function returnChildren(n: ReturnStmt): readonly ASTNodePy[] {
  return n.value !== undefined ? [n.value] : [];
}
function tryChildren(n: TryStmt): readonly ASTNodePy[] {
  return [...n.handlers, ...n.body];
}
function unknownStatementChildren(_n: UnknownStatement): readonly ASTNodePy[] {
  return [];
}
function whileChildren(n: WhileStmt): readonly ASTNodePy[] {
  return [n.test, ...n.body];
}
function withChildren(n: WithStmt): readonly ASTNodePy[] {
  return [...n.items, ...n.body];
}
function yieldStmtChildren(n: YieldStmt): readonly ASTNodePy[] {
  return n.value !== undefined ? [n.value] : [];
}

// Expression children

function attributeChildren(n: Attribute): readonly ASTNodePy[] {
  return [n.value];
}
function awaitChildren(n: Await): readonly ASTNodePy[] {
  return [n.value];
}
function binOpChildren(n: BinOp): readonly ASTNodePy[] {
  return [n.left, n.right];
}
function boolOpChildren(n: BoolOp): readonly ASTNodePy[] {
  return n.values;
}
function callChildren(n: Call): readonly ASTNodePy[] {
  return [n.func, ...n.args];
}
function comprehensionChildren(n: Comprehension): readonly ASTNodePy[] {
  return n.body;
}
function conditionalChildren(n: Conditional): readonly ASTNodePy[] {
  return [n.test, n.consequent, n.alternate];
}
function constantChildren(_n: Constant): readonly ASTNodePy[] {
  return [];
}
function decoratorChildren(n: Decorator): readonly ASTNodePy[] {
  return [n.expression];
}
function dictChildren(n: Dict): readonly ASTNodePy[] {
  // Walk each entry in source order: key (if present) then value. Pure
  // structural data — DictEntry itself is not a walkable AST node.
  const out: ASTNodePy[] = [];
  for (const entry of n.entries) {
    if (entry.key !== undefined) out.push(entry.key);
    out.push(entry.value);
  }
  return out;
}
function fstringChildren(n: FString): readonly ASTNodePy[] {
  // `quasis` is a list of cooked string segments (not nodes) — only the
  // inner `parts` are walkable.
  return n.parts;
}
function lambdaChildren(n: Lambda): readonly ASTNodePy[] {
  return [n.body];
}
function listChildren(n: List): readonly ASTNodePy[] {
  return n.elements;
}
function nameChildren(_n: Name): readonly ASTNodePy[] {
  return [];
}
function setChildren(n: PySet): readonly ASTNodePy[] {
  return n.elements;
}
function starredChildren(n: Starred): readonly ASTNodePy[] {
  return [n.value];
}
function subscriptChildren(n: Subscript): readonly ASTNodePy[] {
  return [n.value, n.slice];
}
function tupleChildren(n: Tuple): readonly ASTNodePy[] {
  return n.elements;
}
function unaryOpChildren(n: UnaryOp): readonly ASTNodePy[] {
  return [n.operand];
}
function unknownExpressionChildren(_n: UnknownExpression): readonly ASTNodePy[] {
  return [];
}
function walrusChildren(n: Walrus): readonly ASTNodePy[] {
  // `target` is a binding name (not a walkable node); only `value` descends.
  return [n.value];
}
function yieldChildren(n: Yield): readonly ASTNodePy[] {
  return n.value !== undefined ? [n.value] : [];
}

/**
 * Depth-first walk over `root`. Determinism: children are walked in
 * declaration order with no sort; two consecutive walks of the same `root`
 * produce the same call sequence.
 *
 * Both `onEnter` and `onNode` fire on enter (in that order if both are set);
 * `onLeave` fires after all children have been walked.
 */
export function walkPy(root: ASTNodePy, visitor: PyVisitor): void {
  walkNode(root, null, visitor);
}

function walkNode(node: ASTNodePy, parent: ASTNodePy | null, visitor: PyVisitor): void {
  if (visitor.onEnter !== undefined) visitor.onEnter(node, parent);
  if (visitor.onNode !== undefined) visitor.onNode(node, parent);
  for (const child of childrenOfPy(node)) {
    walkNode(child, node, visitor);
  }
  if (visitor.onLeave !== undefined) visitor.onLeave(node, parent);
}
