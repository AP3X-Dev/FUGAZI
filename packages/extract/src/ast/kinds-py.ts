/**
 * kinds-py.ts — Phase 4a T303 — Python discriminated-union AST kinds.
 *
 * Mirrors the discipline of `./kinds.ts` (the TS/JS union) for Python sources.
 * The shape produced by the tree-sitter-python adapter (T304, populating
 * `packages/extract/src/parsers-py/tree-sitter.ts`) after Phase 4a Wave 2
 * normalisation. The union is INTENTIONALLY narrow — only the node kinds the
 * Phase 4a Python visitor pass (T305) + downstream graph builder consume.
 * Every other parser-emitted node collapses to `UnknownStatement` /
 * `UnknownExpression` carrying just its source range.
 *
 * The discriminated union is the STABLE BOUNDARY between the underlying
 * tree-sitter-python WASM grammar and the rest of @fugazi/extract. As long as
 * the adapter produces values matching this union for a given source, the
 * Python visitor pass is parser-engine-agnostic; if a future wave swaps the
 * grammar (e.g. for a faster native parser), the visitor surface is unchanged.
 *
 * Determinism (NFR-1): every property is `readonly`, every collection is an
 * `Array` (insertion-ordered), no `Map` / `Set` appears anywhere in the AST.
 * Reporters serializing a `PyProgram` walk in declaration order with no sort.
 *
 * Immutability (FR-D3): the union types are deeply readonly. Adapter code
 * (T304) constructs frozen objects in a single pass; no field is reassigned
 * after construction.
 *
 * Per-kind interfaces below are stacked in alphabetical order by `kind` for
 * grep ergonomics. The exhaustiveness contract is enforced via `assertNever`
 * switches in the test suite and `./visit-py.ts` — adding a new variant
 * without a matching case will fail `tsc --noEmit`.
 *
 * Per IMP-DEBT-08: Fugazi NEVER uses a string-based sentinel pipeline. The
 * Python visitor pass operates exclusively on this discriminated union —
 * sentinel strings are forbidden by SC-17.
 *
 * Reserved (T306): module-level `__all__ = [...]` extraction will surface as a
 * sibling field on the future `Module` inventory shape (NOT on `PyProgram`
 * directly — `PyProgram` stays parse-shape only). This file does not yet
 * declare that field; the visitor (T305) owns inventory-side extraction.
 */

import type { Range } from '@fugazi/types';

// --------------------------------------------------------------------------
// STATEMENTS
// --------------------------------------------------------------------------

/**
 * `AnnAssign` — annotated assignment, `x: int = 1` or bare `x: int`.
 *
 * `target` is the LHS identifier name (or empty string when the target is a
 * pattern the adapter chose not to surface). `annotation` is the annotation
 * expression (e.g. the `int` Name). `value` is `undefined` when the form is a
 * bare annotation with no initializer (`x: int`). T307 uses AnnAssign to
 * detect `TypeAlias` declarations (`X: TypeAlias = ...`).
 */
export interface AnnAssign {
  readonly kind: 'AnnAssign';
  readonly range: Range;
  readonly target: string;
  readonly annotation: PyExpression;
  readonly value?: PyExpression;
}

/**
 * `Assign` — Python assignment, possibly multi-target: `x = 1`, `a = b = 2`.
 *
 * `targets` lists each LHS in declaration order; for `a = b = 1` it is
 * `['a', 'b']`. Pattern targets (`(x, y) = pair`) flatten to bound names; the
 * empty string surfaces for adapter-classified opaque patterns. `value` is the
 * RHS expression.
 */
export interface Assign {
  readonly kind: 'Assign';
  readonly range: Range;
  readonly targets: readonly string[];
  readonly value: PyExpression;
}

/**
 * `AsyncFunctionDef` — `async def foo(...): ...`. Fields mirror `FunctionDef`
 * exactly; the kind discriminator is the only difference. Decorator stacks
 * apply through `decorators`, identical to the sync form.
 */
export interface AsyncFunctionDef {
  readonly kind: 'AsyncFunctionDef';
  readonly range: Range;
  readonly name: string;
  readonly params: readonly PyParameter[];
  readonly body: readonly PyStatement[];
  readonly decorators: readonly Decorator[];
}

/**
 * `AugAssign` — augmented assignment, `x += 1`, `xs *= 2`. `target` is the LHS
 * name (empty string for opaque patterns). `op` carries the operator token
 * verbatim (`+=`, `-=`, `*=`, `/=`, `//=`, `%=`, `**=`, `&=`, `|=`, `^=`,
 * `>>=`, `<<=`, `@=`).
 */
export interface AugAssign {
  readonly kind: 'AugAssign';
  readonly range: Range;
  readonly target: string;
  readonly op: string;
  readonly value: PyExpression;
}

/**
 * `Break` — bare `break` keyword statement.
 */
export interface Break {
  readonly kind: 'Break';
  readonly range: Range;
}

/**
 * `ClassDef` — `class Foo(Base, metaclass=Meta): ...`.
 *
 * `bases` lists base-class expressions (typically `Name` or `Attribute`).
 * `members` lists the names of class-body assignments + nested function names
 * in declaration order (used by unused-class-members analysis, T305).
 * `decorators` records decorator stack in source order (top-most first).
 */
export interface ClassDef {
  readonly kind: 'ClassDef';
  readonly range: Range;
  readonly name: string;
  readonly bases: readonly PyExpression[];
  readonly body: readonly PyStatement[];
  readonly members: readonly string[];
  readonly decorators: readonly Decorator[];
}

/**
 * `Continue` — bare `continue` keyword statement.
 */
export interface Continue {
  readonly kind: 'Continue';
  readonly range: Range;
}

/**
 * `Decorator` — `@expr` applied to a function or class. Carried as a child of
 * `FunctionDef` / `AsyncFunctionDef` / `ClassDef.decorators`, NOT a top-level
 * statement variant — this matches Python's stdlib `ast` module shape and
 * keeps the statement union focused on top-level forms.
 *
 * `expression` is the decorator value (typically a `Name`, `Attribute`, or
 * `Call`). The walker descends into it via `childrenOfPy`.
 */
export interface Decorator {
  readonly kind: 'Decorator';
  readonly range: Range;
  readonly expression: PyExpression;
}

/**
 * `ExpressionStmt` — a bare expression evaluated as a statement, e.g. a
 * docstring or a function call: `"docstring"`, `foo()`. `expression` is the
 * inner value, allowing the visitor to descend into call / attribute chains.
 */
export interface ExpressionStmt {
  readonly kind: 'ExpressionStmt';
  readonly range: Range;
  readonly expression: PyExpression;
}

/**
 * `ForStmt` — `for x in iterable: ... else: ...`. Both branches collapse into
 * `body` (loop body first, then `else` branch if present); the visitor walks
 * uniformly. `target` records the bound name (empty string for opaque tuple
 * patterns). `iter` is the iterable expression.
 */
export interface ForStmt {
  readonly kind: 'ForStmt';
  readonly range: Range;
  readonly target: string;
  readonly iter: PyExpression;
  readonly body: readonly PyStatement[];
}

/**
 * `FunctionDef` — `def foo(...): ...`.
 *
 * `params` records parameter identifier names + simple flags (positional /
 * `*args` / `**kwargs`). `body` is the function body in declaration order.
 * `decorators` records decorator stack in source order (top-most first).
 */
export interface FunctionDef {
  readonly kind: 'FunctionDef';
  readonly range: Range;
  readonly name: string;
  readonly params: readonly PyParameter[];
  readonly body: readonly PyStatement[];
  readonly decorators: readonly Decorator[];
}

/**
 * `IfStmt` — `if cond: ... elif ...: ... else: ...`. All branches collapse
 * into `body` (consequent first, then `elif`/`else` consequents in source
 * order). The visitor walks uniformly without distinguishing branches.
 */
export interface IfStmt {
  readonly kind: 'IfStmt';
  readonly range: Range;
  readonly test: PyExpression;
  readonly body: readonly PyStatement[];
}

/**
 * `ImportFromStmt` — `from x import y`, `from . import z`, `from x import *`.
 *
 * `module` is the dotted module path (`'x.y'`); `null` for bare `from .
 * import z` (relative-only with no module name). `level` is the relative-dot
 * count (0 for absolute, 1 for `from .`, 2 for `from ..`, etc.). `names` lists
 * imported binding names in declaration order; the singleton `['*']` denotes
 * `import *`.
 */
export interface ImportFromStmt {
  readonly kind: 'ImportFromStmt';
  readonly range: Range;
  readonly module: string | null;
  readonly level: number;
  readonly names: readonly string[];
}

/**
 * `ImportStmt` — `import x`, `import x as y`, `import x.y`, `import a, b`.
 *
 * `names` is the list of dotted module specifiers in declaration order
 * (e.g. `['os.path', 'sys']` for `import os.path, sys`). The visitor (T305)
 * pairs these with the binding names extracted by the adapter.
 */
export interface ImportStmt {
  readonly kind: 'ImportStmt';
  readonly range: Range;
  readonly names: readonly string[];
}

/**
 * `MatchStmt` — Python 3.10+ structural pattern matching:
 * `match x: case ...: ...`. Cases collapse into `body` (each case's
 * consequent statements concatenated in declaration order). The visitor walks
 * `body` uniformly; pattern shape itself is not currently inspected.
 */
export interface MatchStmt {
  readonly kind: 'MatchStmt';
  readonly range: Range;
  readonly subject: PyExpression;
  readonly body: readonly PyStatement[];
}

/**
 * `Pass` — bare `pass` keyword statement. Listed for exhaustiveness.
 */
export interface Pass {
  readonly kind: 'Pass';
  readonly range: Range;
}

/**
 * `RaiseStmt` — `raise`, `raise Exc`, `raise Exc from cause`. `exception` is
 * `undefined` for bare `raise` (re-raise current exception). `cause` is
 * `undefined` when no `from` clause is present.
 */
export interface RaiseStmt {
  readonly kind: 'RaiseStmt';
  readonly range: Range;
  readonly exception?: PyExpression;
  readonly cause?: PyExpression;
}

/**
 * `ReturnStmt` — `return` or `return value`. `value` is `undefined` for bare
 * `return` (returns `None` implicitly).
 */
export interface ReturnStmt {
  readonly kind: 'ReturnStmt';
  readonly range: Range;
  readonly value?: PyExpression;
}

/**
 * `TryStmt` — `try: ... except ...: ... else: ... finally: ...`. All branches
 * collapse into `body` (try body first, then handlers in source order, then
 * `else`, then `finally`). `handlers` lists exception-type expressions for
 * each `except` clause in source order — used by visitor for usage tracking.
 */
export interface TryStmt {
  readonly kind: 'TryStmt';
  readonly range: Range;
  readonly body: readonly PyStatement[];
  readonly handlers: readonly PyExpression[];
}

/**
 * `UnknownStatement` — catch-all for every statement form not surfaced above.
 * `UnknownStatement` is the stable contract for "we know this is some
 * statement but the adapter hasn't classified it." Future waves narrow this
 * by adding new variants; existing emitters keep working.
 */
export interface UnknownStatement {
  readonly kind: 'UnknownStatement';
  readonly range: Range;
}

/**
 * `WhileStmt` — `while cond: ... else: ...`. As with `ForStmt`, the loop body
 * and `else` branch collapse into `body`.
 */
export interface WhileStmt {
  readonly kind: 'WhileStmt';
  readonly range: Range;
  readonly test: PyExpression;
  readonly body: readonly PyStatement[];
}

/**
 * `WithStmt` — `with ctx as v, ctx2 as v2: ...`. `items` lists context-manager
 * expressions in declaration order (the bound names are not currently
 * preserved as walkable nodes; the visitor reads them off the adapter via the
 * outer inventory pass). `body` is the with-block in declaration order.
 */
export interface WithStmt {
  readonly kind: 'WithStmt';
  readonly range: Range;
  readonly items: readonly PyExpression[];
  readonly body: readonly PyStatement[];
}

/**
 * `YieldStmt` — statement-form `yield expr` or `yield from expr` at the
 * statement position. The expression-form `Yield` (used inside a larger
 * expression) is a separate variant on the expression union.
 *
 * `from` distinguishes `yield x` (`false`) from `yield from x` (`true`).
 * `value` is `undefined` for bare `yield` with no expression (rare but legal).
 */
export interface YieldStmt {
  readonly kind: 'YieldStmt';
  readonly range: Range;
  readonly from: boolean;
  readonly value?: PyExpression;
}

// --------------------------------------------------------------------------
// EXPRESSIONS
// --------------------------------------------------------------------------

/**
 * `Attribute` — `obj.attr`. The visitor uses this for member-access usage
 * tracking, parallel to `MemberExpression` in the TS union. `value` is the
 * receiver expression; `attr` is the accessed name.
 */
export interface Attribute {
  readonly kind: 'Attribute';
  readonly range: Range;
  readonly value: PyExpression;
  readonly attr: string;
}

/**
 * `Await` — `await expr`. Visitor descends into `value` for usage tracking.
 */
export interface Await {
  readonly kind: 'Await';
  readonly range: Range;
  readonly value: PyExpression;
}

/**
 * `BinOp` — binary operator expression: `a + b`, `a // b`, `a @ b` (matrix
 * multiply). `op` carries the operator token verbatim for downstream
 * inspection (`+`, `-`, `*`, `/`, `//`, `%`, `**`, `&`, `|`, `^`, `>>`, `<<`,
 * `@`).
 */
export interface BinOp {
  readonly kind: 'BinOp';
  readonly range: Range;
  readonly op: string;
  readonly left: PyExpression;
  readonly right: PyExpression;
}

/**
 * `BoolOp` — boolean operator expression: `a and b and c`, `x or y`. `op` is
 * either `'and'` or `'or'`; `values` lists operand expressions in source
 * order (chained `a and b and c` flattens to a single BoolOp with three
 * values).
 */
export interface BoolOp {
  readonly kind: 'BoolOp';
  readonly range: Range;
  readonly op: 'and' | 'or';
  readonly values: readonly PyExpression[];
}

/**
 * `Call` — `f(x, y, k=v)`. Parallel to `CallExpression` in the TS union.
 *
 * `func` is the callee (typically `Name`, `Attribute`, or another `Call`).
 * `args` lists positional-arg expressions in declaration order; keyword
 * arguments are surfaced as `Starred` (for `**kwargs`) or as opaque entries
 * the adapter chose not to detail. The visitor uses Call to detect dynamic
 * imports (`__import__('m')`) and `importlib.import_module('m')` patterns.
 */
export interface Call {
  readonly kind: 'Call';
  readonly range: Range;
  readonly func: PyExpression;
  readonly args: readonly PyExpression[];
}

/**
 * `Comprehension` — list/set/dict/generator comprehension. `compKind`
 * distinguishes the four flavours; the rest of the structure (target / iter /
 * filters / element) is folded into a single `body` array of inner
 * expressions in source order. The visitor walks `body` uniformly.
 */
export interface Comprehension {
  readonly kind: 'Comprehension';
  readonly range: Range;
  readonly compKind: 'list' | 'set' | 'dict' | 'generator';
  readonly body: readonly PyExpression[];
}

/**
 * `Conditional` — `x if cond else y` ternary expression. Mirrors Python's
 * `ast.IfExp`. The walker descends into all three sub-expressions.
 */
export interface Conditional {
  readonly kind: 'Conditional';
  readonly range: Range;
  readonly test: PyExpression;
  readonly consequent: PyExpression;
  readonly alternate: PyExpression;
}

/**
 * `Constant` — literal value: string / number / bytes / None / True / False.
 * `value` matches Python's stdlib `ast.Constant.value` shape. We use a
 * narrowed union here to avoid leaking arbitrary types through the AST.
 */
export interface Constant {
  readonly kind: 'Constant';
  readonly range: Range;
  readonly value: string | number | boolean | null;
}

/**
 * `Dict` — dict-display literal `{k: v, ...}`. `entries` lists key-value
 * expression pairs in source order; the walker descends into both halves.
 * Dict-unpacking entries (`**other`) surface with `key === undefined`.
 */
export interface Dict {
  readonly kind: 'Dict';
  readonly range: Range;
  readonly entries: readonly DictEntry[];
}

/**
 * Lightweight key-value carrier inside a `Dict` literal. `key` is undefined
 * for `**other` unpacking entries; `value` is always present. NOT a member of
 * the `PyASTNode` union — this is structural data rather than a walkable node.
 */
export interface DictEntry {
  readonly key?: PyExpression;
  readonly value: PyExpression;
  readonly range: Range;
}

/**
 * `FString` — f-string literal with embedded expressions:
 * `f"prefix {x:>4} suffix"`. `quasis` is the literal string segments; `parts`
 * is the inner expression nodes for the `{...}` slots. The invariant
 * `quasis.length === parts.length + 1` always holds (mirrors the TS
 * `TemplateLiteral` shape).
 */
export interface FString {
  readonly kind: 'FString';
  readonly range: Range;
  readonly quasis: readonly string[];
  readonly parts: readonly PyExpression[];
}

/**
 * `Lambda` — `lambda x, y: expr`. `params` mirrors `FunctionDef.params`
 * shape. `body` is the single expression body — for visitor uniformity it is
 * walked through `childrenOfPy`.
 */
export interface Lambda {
  readonly kind: 'Lambda';
  readonly range: Range;
  readonly params: readonly PyParameter[];
  readonly body: PyExpression;
}

/**
 * `List` — list-display literal `[a, b, ...]`. `elements` is the inner
 * expression nodes in source order.
 */
export interface List {
  readonly kind: 'List';
  readonly range: Range;
  readonly elements: readonly PyExpression[];
}

/**
 * `Name` — bare identifier reference, `foo`. Parallel to `Identifier` in the
 * TS union; visitor uses this for free-variable usage tracking.
 */
export interface Name {
  readonly kind: 'Name';
  readonly range: Range;
  readonly id: string;
}

/**
 * `Set` — set-display literal `{a, b, ...}`. (Empty `{}` is a `Dict`, not a
 * `Set`, per Python's grammar.) `elements` is the inner expression nodes in
 * source order.
 */
export interface Set {
  readonly kind: 'Set';
  readonly range: Range;
  readonly elements: readonly PyExpression[];
}

/**
 * `Starred` — `*args` / `**kwargs` unpacking expression. `value` is the
 * inner expression. The walker descends into it.
 */
export interface Starred {
  readonly kind: 'Starred';
  readonly range: Range;
  readonly value: PyExpression;
}

/**
 * `Subscript` — `x[i]`, `x[a:b:c]`, `x[a, b]`. `value` is the receiver,
 * `slice` is the index/slice expression. The walker descends into both.
 */
export interface Subscript {
  readonly kind: 'Subscript';
  readonly range: Range;
  readonly value: PyExpression;
  readonly slice: PyExpression;
}

/**
 * `Tuple` — tuple-display literal `(a, b, ...)`. `elements` is the inner
 * expression nodes in source order.
 */
export interface Tuple {
  readonly kind: 'Tuple';
  readonly range: Range;
  readonly elements: readonly PyExpression[];
}

/**
 * `UnaryOp` — unary operator expression: `not x`, `-x`, `+x`, `~x`. `op`
 * carries the operator token verbatim (`not`, `-`, `+`, `~`).
 */
export interface UnaryOp {
  readonly kind: 'UnaryOp';
  readonly range: Range;
  readonly op: string;
  readonly operand: PyExpression;
}

/**
 * `UnknownExpression` — catch-all for every expression form not surfaced
 * above. The visitor treats these as opaque (no descent into children).
 */
export interface UnknownExpression {
  readonly kind: 'UnknownExpression';
  readonly range: Range;
}

/**
 * `Walrus` — named-expression `(x := y)` (PEP 572, Py 3.8+). `target` is the
 * assigned name; `value` is the assigned expression. The walker descends
 * into `value` only — the target is a binding, not a walkable expression.
 */
export interface Walrus {
  readonly kind: 'Walrus';
  readonly range: Range;
  readonly target: string;
  readonly value: PyExpression;
}

/**
 * `Yield` — expression-form `yield expr` used inside a larger expression
 * (e.g. `x = (yield foo)`). The statement-form `YieldStmt` is a separate
 * variant on the statement union.
 *
 * `from` distinguishes `yield x` (`false`) from `yield from x` (`true`).
 * `value` is `undefined` for bare `yield` with no expression.
 */
export interface Yield {
  readonly kind: 'Yield';
  readonly range: Range;
  readonly from: boolean;
  readonly value?: PyExpression;
}

// --------------------------------------------------------------------------
// STRUCTURAL CARRIERS (NOT walkable AST nodes)
// --------------------------------------------------------------------------

/**
 * Lightweight name-carrier for a single function/lambda parameter. NOT a
 * member of the `PyASTNode` union — this is structural data rather than a
 * walkable node. Visitors needing parameter names read `node.params` directly
 * inside an `onNode` handler.
 *
 * `kind` distinguishes positional (`'pos'`), positional-only-marker
 * (`'pos-only'` for `/`), keyword-only-marker (`'kw-only'` for the `*`
 * separator), `*args` (`'vararg'`), and `**kwargs` (`'kwarg'`).
 */
export interface PyParameter {
  readonly name: string;
  readonly kind: 'pos' | 'pos-only' | 'kw-only' | 'vararg' | 'kwarg';
  readonly range: Range;
}

// --------------------------------------------------------------------------
// PROGRAM ROOT
// --------------------------------------------------------------------------

/**
 * `PyProgram` — the root of every successfully-parsed Python source. `body` is
 * the ordered list of top-level statements; `filename` echoes the input
 * options for reporter convenience. Parallel to TS `Program` but without a
 * `language` field (the kind discriminator already pins it to Python).
 */
export interface PyProgram {
  readonly kind: 'PyProgram';
  readonly body: readonly PyStatement[];
  readonly filename: string;
  readonly range: Range;
}

// --------------------------------------------------------------------------
// UNIONS
// --------------------------------------------------------------------------

/**
 * Closed union over every statement-shaped node Fugazi's Python visitor
 * recognises. Adding a new variant requires updating every `assertNever`
 * switch in this package — `tsc --noEmit` will flag missed cases.
 */
export type PyStatement =
  | AnnAssign
  | Assign
  | AsyncFunctionDef
  | AugAssign
  | Break
  | ClassDef
  | Continue
  | ExpressionStmt
  | ForStmt
  | FunctionDef
  | IfStmt
  | ImportFromStmt
  | ImportStmt
  | MatchStmt
  | Pass
  | RaiseStmt
  | ReturnStmt
  | TryStmt
  | UnknownStatement
  | WhileStmt
  | WithStmt
  | YieldStmt;

/**
 * Closed union over every expression-shaped node Fugazi's Python visitor
 * recognises. Anything else collapses to `UnknownExpression`.
 */
export type PyExpression =
  | Attribute
  | Await
  | BinOp
  | BoolOp
  | Call
  | Comprehension
  | Conditional
  | Constant
  | Decorator
  | Dict
  | FString
  | Lambda
  | List
  | Name
  | Set
  | Starred
  | Subscript
  | Tuple
  | UnaryOp
  | UnknownExpression
  | Walrus
  | Yield;

/**
 * `ASTNodePy` — the closed union over EVERY walkable Python node. The
 * `walkPy()` helper in `./visit-py.ts` switches over this union with
 * `assertNever` to guarantee compile-time exhaustiveness.
 *
 * `Decorator` appears under PyExpression because that is the only position
 * where the walker reaches it — `FunctionDef.decorators` / `ClassDef.decorators`
 * arrays. It is never a top-level statement.
 */
export type ASTNodePy = PyProgram | PyStatement | PyExpression;
