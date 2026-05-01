/**
 * kinds.ts — Phase 3c.4 Dispatch A (T062) — discriminated-union AST kinds.
 *
 * The shape produced by Fugazi's parser adapter (`packages/extract/src/parsers/oxc.ts`)
 * after Wave 5b-2 normalisation. The union is INTENTIONALLY narrow — only the
 * node kinds the Phase 3c.4 visitor pass + downstream graph builder consume.
 * Every other parser-emitted node collapses to `UnknownStatement` /
 * `UnknownExpression` carrying just its source range.
 *
 * The discriminated union is the STABLE BOUNDARY between the underlying parser
 * engine (currently @swc/wasm; a future wave may add a second engine for
 * cross-validation) and the rest of @fugazi/extract. As long as both engines
 * produce values matching this union for a given source, the visitor pass is
 * engine-agnostic and the parser-equivalence test reduces to deep structural
 * comparison.
 *
 * Determinism (NFR-1): every property is `readonly`, every collection is an
 * `Array` (insertion-ordered), no `Map` / `Set` appears anywhere in the AST.
 * Reporters serializing a `Program` walk in declaration order with no sort.
 *
 * Immutability (FR-D3): the union types are deeply readonly. Adapter code
 * constructs frozen objects in a single pass; no field is reassigned after
 * construction.
 *
 * Per-kind interfaces below are stacked in alphabetical order by `kind` for
 * grep ergonomics. The exhaustiveness contract (T061-test #1..#3) is enforced
 * via `assertNever` switches in the test suite — adding a new variant without
 * a matching case will fail `tsc --noEmit`.
 *
 * Per IMP-DEBT-08: Fugazi NEVER reintroduces the original Fallow's
 * string-based sentinel pipeline. The visitor pass operates exclusively on
 * this discriminated union — sentinel strings are forbidden by SC-17.
 */

import type { Range } from '@fugazi/types';
import type { Language } from '../parsers/types.js';

/**
 * `BlockStatement` — a `{ ... }` brace-delimited block. SWC emits these for
 * function bodies, control-flow consequent/alternate slots, and explicit
 * standalone blocks. We surface them here so the visitor can recurse uniformly.
 */
export interface BlockStatement {
  readonly kind: 'BlockStatement';
  readonly range: Range;
  readonly body: readonly Statement[];
}

/**
 * `CallExpression` — `f(a, b)`. CRITICAL for Wave 5b-3's dynamic-import
 * detection: `import('./x')` arrives as a CallExpression whose callee is the
 * special `Import` node (mapped here to a synthetic `Identifier` with
 * name `'import'` for downstream pattern matching).
 */
export interface CallExpression {
  readonly kind: 'CallExpression';
  readonly range: Range;
  readonly callee: Expression;
  readonly args: readonly Expression[];
}

/**
 * `ClassDecl` — `class Foo {}` and `@dec class Foo {}`.
 *
 * `name` is `null` for the FunctionExpression / ClassExpression that appears
 * as the right-hand side of `export default ...`. `members` lists the names
 * of class properties / methods (used by unused-class-members analysis).
 * `decorators` lists decorator-target identifiers.
 */
export interface ClassDecl {
  readonly kind: 'ClassDecl';
  readonly range: Range;
  readonly name: string | null;
  readonly body: readonly Statement[];
  readonly members: readonly Identifier[];
  readonly decorators: readonly Identifier[];
}

/**
 * `EnumDecl` — `enum Color { Red, Green }`. `members` lists each enum member's
 * identifier in declaration order (used by unused-enum-members analysis).
 */
export interface EnumDecl {
  readonly kind: 'EnumDecl';
  readonly range: Range;
  readonly name: string;
  readonly members: readonly Identifier[];
}

/**
 * `ExportDecl` — every export form: `export const x = 1;`,
 * `export { y } from './z';`, `export default ...`, `export * from './w';`.
 * `source` is non-null only for re-exports (`from './w'`); for declarations
 * exporting a local symbol it is `null`.
 *
 * `declaration` is the wrapped `FunctionDecl` / `ClassDecl` / `VariableDecl` /
 * `TypeDecl` / `EnumDecl` for forms like `export function f() {}` and
 * `export default function g() {}`. Absent for plain re-exports
 * (`export { x } from './m'`) and bare specifier exports (`export { x }`).
 * The visitor uses this to flag the wrapped declaration's `exported: true`.
 *
 * NOTE: This was named `ExportDeclaration` through Wave 5b-2; Phase 3c.4
 * renamed it to `ExportDecl` for consistency with `FunctionDecl` / `ClassDecl`.
 */
export interface ExportDecl {
  readonly kind: 'ExportDecl';
  readonly range: Range;
  readonly source: string | null;
  readonly declaration?: Statement;
}

/**
 * `ExpressionStatement` — a top-level expression evaluated for its side
 * effects, e.g. `foo();` or `x = 1;`. `expression` is the inner value, allowing
 * the visitor to descend into call / member chains.
 */
export interface ExpressionStatement {
  readonly kind: 'ExpressionStatement';
  readonly range: Range;
  readonly expression: Expression;
}

/**
 * `ForStatement` — covers `for (;;)`, `for...in`, and `for...of`. We intentionally
 * collapse the three loop variants because the visitor only needs to walk the
 * body for usage detection. `body` always carries 0+ statements (a bare-stmt
 * body is wrapped into a singleton).
 */
export interface ForStatement {
  readonly kind: 'ForStatement';
  readonly range: Range;
  readonly body: readonly Statement[];
}

/**
 * `FunctionDecl` — `function foo() {}`.
 *
 * `name` is `null` for the FunctionExpression that appears as the right-hand
 * side of `export default function() {}`. `params` records identifier names
 * (we do not preserve destructuring shape; pattern-bound params surface as a
 * single `Identifier` with `name = ''`).
 */
export interface FunctionDecl {
  readonly kind: 'FunctionDecl';
  readonly range: Range;
  readonly name: string | null;
  readonly body: readonly Statement[];
  readonly params: readonly Identifier[];
}

/**
 * `Identifier` — a referenced name. `Identifier` is also reused as a
 * lightweight name-carrier for class / enum members and decorator targets,
 * keeping the union narrow.
 */
export interface Identifier {
  readonly kind: 'Identifier';
  readonly range: Range;
  readonly name: string;
}

/**
 * `IfStatement` — `if (cond) ... else ...`. Both branches collapse into a
 * single `body` array because the visitor does not need to distinguish them
 * for usage / declaration extraction. `body.length` is at most 2 (consequent +
 * alternate); a missing alternate leaves it at 1.
 */
export interface IfStatement {
  readonly kind: 'IfStatement';
  readonly range: Range;
  readonly body: readonly Statement[];
}

/**
 * `ImportDecl` — `import foo from './x';` and friends. `source` carries the
 * raw module specifier verbatim (no resolution applied).
 *
 * NOTE: This was named `ImportDeclaration` through Wave 5b-2; Phase 3c.4
 * renamed it to `ImportDecl` for consistency with `FunctionDecl` / `ClassDecl`.
 */
export interface ImportDecl {
  readonly kind: 'ImportDecl';
  readonly range: Range;
  readonly source: string;
}

/**
 * `ImportMeta` — the `import.meta` MetaProperty. Recognised as a leaf so the
 * visitor can detect `new URL('./x', import.meta.url)` asset-edge patterns
 * (Wave 5b-3 / T066). `range` covers the literal `import.meta` token pair.
 */
export interface ImportMeta {
  readonly kind: 'ImportMeta';
  readonly range: Range;
}

/**
 * `JSXElement` — a JSX/TSX tag. `name` captures the OPENING-TAG identifier
 * (component name for `<Foo />`, lowercase tag for `<div />`). The visitor
 * uses this to attribute usages to component identifiers.
 */
export interface JSXElement {
  readonly kind: 'JSXElement';
  readonly range: Range;
  readonly name: string;
}

/**
 * `Literal` — string / number / boolean / null. CallExpression args carrying
 * a single string literal are how dynamic `import('./x')` surfaces its module
 * specifier to the resolver.
 */
export interface Literal {
  readonly kind: 'Literal';
  readonly range: Range;
  readonly value: string | number | boolean | null;
}

/**
 * `MemberExpression` — `a.b` and `a[b]`. Visitor uses this to recognise
 * `import.meta.url` (object: ImportMeta, property: Identifier 'url'). We treat
 * computed and dotted-access uniformly — the property always surfaces as an
 * `Identifier` (computed expressions collapse to a name of `''`).
 */
export interface MemberExpression {
  readonly kind: 'MemberExpression';
  readonly range: Range;
  readonly object: Expression;
  readonly property: Identifier;
}

/**
 * `Program` — the root of every successfully-parsed source. `body` is the
 * ordered list of top-level statements; `filename` echoes the input options
 * for reporter convenience; `language` records which parser configuration was
 * used (so a downstream tool can branch on language without re-deriving it
 * from the filename).
 */
export interface Program {
  readonly kind: 'Program';
  readonly body: readonly Statement[];
  readonly filename: string;
  readonly language: Language;
  readonly range: Range;
}

/**
 * `SwitchStatement` — cases collapse into a single `body` array (each case's
 * consequent statements concatenated in declaration order). The visitor walks
 * `body` uniformly; reporters preserving switch shape would need a finer node,
 * but no current consumer requires it.
 */
export interface SwitchStatement {
  readonly kind: 'SwitchStatement';
  readonly range: Range;
  readonly body: readonly Statement[];
}

/**
 * `TypeDecl` — TypeScript `type X = ...;` and `interface Y { ... }`. Both
 * collapse to this kind because the visitor only consumes the declared name
 * for unused-types analysis; the structural body is not currently inspected.
 */
export interface TypeDecl {
  readonly kind: 'TypeDecl';
  readonly range: Range;
  readonly name: string;
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
 * `VariableDecl` — `const`, `let`, `var` declarations. `declarations` lists
 * each declarator's bound name (destructuring patterns flatten to their bound
 * identifier names in declaration order). `declKind` mirrors SWC's `kind`
 * field on the VariableDeclaration node.
 */
export interface VariableDecl {
  readonly kind: 'VariableDecl';
  readonly range: Range;
  readonly declKind: 'const' | 'let' | 'var';
  readonly declarations: readonly VariableDeclarator[];
}

/**
 * Lightweight name-carrier for a single binding inside a `VariableDecl`. Not
 * a member of the `ASTNode` union — this is structural data rather than a
 * walkable AST node.
 */
export interface VariableDeclarator {
  readonly name: string;
  readonly range: Range;
}

/**
 * `WhileStatement` — covers both `while` and `do...while`. As with
 * `ForStatement`, the variants collapse because the visitor only needs to
 * walk `body`.
 */
export interface WhileStatement {
  readonly kind: 'WhileStatement';
  readonly range: Range;
  readonly body: readonly Statement[];
}

/**
 * Closed union over every statement-shaped node Fugazi's visitor recognises.
 * Adding a new variant requires updating every `assertNever` switch in this
 * package — `tsc --noEmit` will flag missed cases.
 */
export type Statement =
  | BlockStatement
  | ClassDecl
  | EnumDecl
  | ExportDecl
  | ExpressionStatement
  | ForStatement
  | FunctionDecl
  | IfStatement
  | ImportDecl
  | SwitchStatement
  | TypeDecl
  | UnknownStatement
  | VariableDecl
  | WhileStatement;

/**
 * Closed union over every expression-shaped node Fugazi's visitor recognises.
 * Anything else collapses to `UnknownExpression`.
 */
export type Expression =
  | CallExpression
  | Identifier
  | ImportMeta
  | JSXElement
  | Literal
  | MemberExpression
  | UnknownExpression;

/**
 * `ASTNode` — the closed union over EVERY walkable node type. The `walk()`
 * helper in `./visit.ts` switches over this union with `assertNever` to
 * guarantee compile-time exhaustiveness.
 */
export type ASTNode = Program | Statement | Expression;
