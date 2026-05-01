/**
 * types.ts — discriminated-union AST shape produced by Fugazi's WASM parser
 * adapter (Wave 5b-2). The shape is INTENTIONALLY minimal: only what the
 * Phase 3c.4 visitor pass + downstream graph builder will consume in the
 * near term. Every other parser-emitted node collapses to `UnknownStatement`
 * carrying just its source range.
 *
 * The discriminated-union exists as a STABLE BOUNDARY between the underlying
 * parser engine (currently @swc/wasm; Wave 5b-3 may add a second engine for
 * cross-validation) and the rest of @fugazi/extract. As long as both engines
 * produce values matching this union for a given source, the visitor pass
 * is engine-agnostic and the parser-equivalence test in Wave 5b-3 reduces to
 * deep structural comparison.
 *
 * Determinism (NFR-1): every property is `readonly`, every collection is an
 * `Array` (insertion-ordered), no `Map` / `Set` appears anywhere in the AST.
 * Reporters serializing a `Program` walk in declaration order with no sort.
 *
 * Immutability (FR-D3): the union types are deeply readonly. Adapter code
 * constructs frozen objects in a single pass; no field is reassigned after
 * construction.
 */

import type { Position, Range } from '@fugazi/types';

/**
 * Source language hint. Mirrors the file-extension dispatch table used by the
 * extraction engine: `.ts` -> 'ts', `.tsx` -> 'tsx', `.js`/`.cjs`/`.mjs` ->
 * 'js', `.jsx` -> 'jsx'. Each maps to a distinct parser configuration:
 *   - 'ts'  : TypeScript without JSX
 *   - 'tsx' : TypeScript with JSX
 *   - 'js'  : Plain ECMAScript without JSX
 *   - 'jsx' : ECMAScript with JSX
 */
export type Language = 'ts' | 'tsx' | 'js' | 'jsx';

/**
 * Options accepted by `parse(source, opts)`. Both fields are required and
 * `readonly` per FR-D3 — callers construct the options object fresh and
 * never mutate it after the call returns.
 */
export interface ParseOptions {
  readonly filename: string;
  readonly lang: Language;
}

/**
 * A single syntax-level diagnostic produced by the parser. The `message` is
 * the verbatim parser output (no reformatting, no trimming) per the
 * IMP-CORRECT-09 contract: downstream code MAY pattern-match on the parser's
 * exact output.
 *
 * `code` is always 'PARSE_SYNTAX_ERROR' at this layer; semantic errors and
 * type errors are out of scope (we run no type-checker). `position` is the
 * parser's best-effort approximation: line is 1-based, column is 0-based
 * (UTF-16 code unit), byteOffset is 0-based UTF-8.
 */
export interface ParseError {
  readonly file: string;
  readonly position: Position;
  readonly message: string;
  readonly code: 'PARSE_SYNTAX_ERROR';
}

/**
 * The root node of every successfully-parsed source. `body` is the ordered
 * list of top-level statements; `filename` echoes the input options for
 * reporter convenience; `language` records which parser configuration was
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
 * Discriminated union of statement kinds the visitor pass currently
 * recognizes. Wave 5b-3 will extend this with finer-grained nodes (function
 * declarations, class declarations, etc.); for now everything that is not
 * an import or export collapses to `UnknownStatement`.
 */
export type Statement = ImportDeclaration | ExportDeclaration | UnknownStatement;

/**
 * `import foo from './x';` and friends. `source` carries the raw module
 * specifier verbatim (no resolution). `kind: 'side-effect'` indicates a
 * bare `import './x';` with no specifiers.
 */
export interface ImportDeclaration {
  readonly kind: 'ImportDeclaration';
  readonly source: string;
  readonly range: Range;
}

/**
 * Any export form: `export const x = 1;`, `export { y } from './z';`,
 * `export default ...`, `export * from './w';`. `source` is non-null only
 * for re-exports (`from './w'`); for declarations exporting a local symbol
 * it is `null`.
 */
export interface ExportDeclaration {
  readonly kind: 'ExportDeclaration';
  readonly source: string | null;
  readonly range: Range;
}

/**
 * Catch-all for every other top-level form. The visitor pass in Phase 3c.4
 * will replace many of these with finer kinds; `UnknownStatement` is the
 * stable contract for "we know this is some statement but the adapter
 * hasn't classified it yet."
 */
export interface UnknownStatement {
  readonly kind: 'UnknownStatement';
  readonly range: Range;
}

/**
 * Result of a single `parse()` call. Either:
 *   - `program` is a fully-populated `Program` and `errors` is empty
 *     (successful parse), OR
 *   - `program` is `null` and `errors` carries one or more
 *     `PARSE_SYNTAX_ERROR` diagnostics (fail-soft contract — the adapter
 *     does NOT throw on syntax errors).
 *
 * WASM integrity / missing errors propagate as thrown
 * `FugaziParseError(WASM_INTEGRITY | WASM_MISSING)` and never appear here.
 */
export interface ParseResult {
  readonly program: Program | null;
  readonly errors: readonly ParseError[];
}
