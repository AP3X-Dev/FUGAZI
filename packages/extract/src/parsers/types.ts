/**
 * types.ts — parser-API surface for Fugazi's WASM parser adapter.
 *
 * Phase 3c.4 split the AST union into `../ast/kinds.ts` (the canonical home)
 * and re-exports the shapes here for backwards compatibility with the existing
 * import paths in tests + downstream packages. Only PARSER-SPECIFIC types
 * (`Language`, `ParseOptions`, `ParseError`, `ParseResult`) live in this file
 * directly — the AST itself is the engine-agnostic stable boundary defined
 * in `ast/kinds.ts`.
 *
 * Determinism (NFR-1): every property is `readonly`, every collection is an
 * `Array` (insertion-ordered), no `Map` / `Set` appears anywhere in the AST.
 *
 * Immutability (FR-D3): the union types are deeply readonly. Adapter code
 * constructs frozen objects in a single pass; no field is reassigned after
 * construction.
 */

import type { Position } from '@fugazi/types';

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

// AST shapes — re-exported from ../ast/kinds.ts. These are the names the
// existing test suite + downstream packages already import from this module.
export type {
  ASTNode,
  ExportDecl,
  Expression,
  ImportDecl,
  Program,
  Statement,
  UnknownStatement,
} from '../ast/kinds.js';
import type { Program } from '../ast/kinds.js';

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
