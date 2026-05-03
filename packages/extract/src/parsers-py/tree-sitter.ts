/**
 * tree-sitter.ts — Phase 4a T301 spike adapter.
 *
 * Lazy-loads the pinned `tree-sitter-python` WASM via the integrity-gated
 * loader in `../wasm/python/load.ts`, parses a Python source string, and
 * returns the raw tree-sitter `Tree` plus a flat list of `ParseError`
 * descriptors collected by walking ERROR nodes. This is intentionally minimal
 * — T303-T305 build the discriminated-union AST + visitor on top of the same
 * Tree shape returned here.
 *
 * Contract:
 *   - WASM integrity / missing errors throw `FugaziParseError(WASM_INTEGRITY)`
 *     or `FugaziParseError(WASM_MISSING)` BEFORE any parse runs.
 *   - Syntax errors are FAIL-SOFT: returned in `result.errors[]`, never thrown.
 *     Tree-sitter is tolerant by design; a partial tree is always returned.
 *   - Output is deterministic byte-for-byte across runs for identical input.
 *   - Byte offsets in the returned tree are 0-based UTF-8 (tree-sitter native).
 *
 * The Parser instance is per-call (web-tree-sitter parsers are cheap to
 * construct), but the compiled `Language` is cached process-wide by the
 * loader. First call pays the WASM-init cost (~50ms); subsequent calls reuse
 * the cached Language and only allocate a fresh Parser scratch state.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Parser from 'web-tree-sitter';
import { loadPythonParser } from '../wasm/python/load.js';

const BLOB_KEY = 'tree-sitter-python';

// Resolve <packages/extract>/ from this file. import.meta.url at runtime
// points at <pkg>/dist/parsers-py/tree-sitter.js (built) or
// <pkg>/src/parsers-py/tree-sitter.ts (vitest); in both layouts the parent of
// `parsers-py` is the package root sibling of `wasm/manifest.json`. Same
// pattern as parsers/oxc.ts.
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * A single tree-sitter parse-error descriptor. `byteOffset` is 0-based UTF-8;
 * `row`/`column` are 0-based and reflect tree-sitter's native Point shape
 * (NOT Fugazi's 1-based-line / 0-based-column LSP semantics — the visitor
 * layer (T303+) translates if/when the discriminated AST surfaces these).
 *
 * `kind` distinguishes the two flavors tree-sitter exposes:
 *   - 'error' — an explicit ERROR node (parser couldn't recover at this point).
 *   - 'missing' — a MISSING node (parser inserted a synthetic token).
 */
export interface ParseError {
  readonly byteOffset: number;
  readonly endByteOffset: number;
  readonly row: number;
  readonly column: number;
  readonly kind: 'error' | 'missing';
  readonly type: string;
}

/**
 * Spike-level result shape. Intentionally exposes the raw tree-sitter
 * `Tree`/`SyntaxNode` so smoke tests can walk the tree directly. T302/T303
 * replace this with the discriminated-union AST.
 */
export interface TreeSitterParseResult {
  readonly tree: Parser.Tree;
  readonly rootNode: Parser.SyntaxNode;
  readonly source: string;
  readonly filename: string;
  readonly errors: readonly ParseError[];
}

const BOM = '﻿';

function stripBom(source: string): string {
  return source.startsWith(BOM) ? source.slice(BOM.length) : source;
}

/**
 * Walk the parse tree depth-first and collect every ERROR / MISSING node.
 *
 * `descendantsOfType('ERROR')` returns explicit error nodes, but won't pick up
 * MISSING (synthetic-insertion) nodes — those are flagged via the `isMissing`
 * property on otherwise-named nodes. We do a single tree-cursor walk rather
 * than two `descendantsOfType` calls so the ordering is stable (tree-cursor
 * is depth-first, left-to-right) and so we observe each node exactly once.
 */
function collectErrors(root: Parser.SyntaxNode): readonly ParseError[] {
  const errors: ParseError[] = [];
  if (!root.hasError) {
    return errors;
  }
  const cursor = root.walk();
  // Reusable visit. Returns when the cursor has finished traversing.
  const visit = (): void => {
    // Inspect the current node.
    const node = cursor.currentNode;
    if (node.isError) {
      errors.push({
        byteOffset: node.startIndex,
        endByteOffset: node.endIndex,
        row: node.startPosition.row,
        column: node.startPosition.column,
        kind: 'error',
        type: node.type,
      });
    } else if (node.isMissing) {
      errors.push({
        byteOffset: node.startIndex,
        endByteOffset: node.endIndex,
        row: node.startPosition.row,
        column: node.startPosition.column,
        kind: 'missing',
        type: node.type,
      });
    }
    // Descend into children, then walk siblings, then back up.
    if (cursor.gotoFirstChild()) {
      do {
        visit();
      } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }
  };
  visit();
  cursor.delete();
  return errors;
}

/**
 * Parse a Python source string into a tree-sitter `Tree`. The promise resolves
 * to a `TreeSitterParseResult`; it never rejects on Python syntax errors —
 * those are surfaced in the `errors` field. The promise DOES reject (as a
 * `FugaziParseError`) on WASM integrity / missing failures, and may reject if
 * the underlying tree-sitter runtime fails to initialize.
 */
export async function parsePython(
  source: string,
  filename: string,
): Promise<TreeSitterParseResult> {
  const parser = await loadPythonParser(BLOB_KEY, PACKAGE_ROOT);
  const stripped = stripBom(source);
  const tree = parser.parse(stripped);
  const root = tree.rootNode;
  const errors = collectErrors(root);
  return {
    tree,
    rootNode: root,
    source: stripped,
    filename,
    errors,
  };
}
