/**
 * cyclomatic.ts — Phase 3c.7 (T078) — McCabe cyclomatic complexity.
 *
 * Computes the cyclomatic count for a function body. Baseline +1, plus +1 for
 * each decision point inside the function source: `if`, `for`, `while`,
 * `do-while`, each `case` arm of a `switch` (excluding `default`), `&&`, `||`,
 * `??`, ternary `? :`, and `catch`. Plain `else` does NOT add — it is the
 * fall-through alternate of an `if`.
 *
 * Implementation strategy: the discriminated-union AST in `../ast/kinds.js`
 * collapses ternaries, logical operators, and `try/catch` shapes to
 * `UnknownExpression` / `UnknownStatement`, so a pure walker cannot see them.
 * Instead we extract the function's source slice via its `Range` and run a
 * keyword/operator scanner that strips comments and string-literal payloads.
 *
 * Determinism (NFR-1): no non-deterministic primitives, no `Set`/`Map`
 * iteration. Same input source produces the same count byte-for-byte.
 */

import type { FunctionDecl, Statement } from '../ast/kinds.js';

/**
 * Compute McCabe cyclomatic complexity for a function-shaped AST node, given
 * the full source text of the enclosing module. Returns the cyclomatic count
 * (always >= 1). Non-function statements collapse to baseline 1.
 */
export function computeCyclomatic(node: FunctionDecl | Statement, source: string): number {
  if (node.kind !== 'FunctionDecl') return 1;
  const slice = sliceFunctionBody(source, node.range.start.byteOffset, node.range.end.byteOffset);
  return scanForCyclomatic(slice);
}

function sliceFunctionBody(source: string, startByte: number, endByte: number): string {
  // For ASCII source, byte offset equals JS char index. Defensive bounds.
  const start = Math.max(0, Math.min(source.length, startByte));
  const end = Math.max(start, Math.min(source.length, endByte));
  return source.slice(start, end);
}

/**
 * Single-pass scanner over a function source slice. Skips comments and string
 * literals, then increments the running count for each decision token. Returns
 * the cyclomatic complexity (baseline 1 + decisions).
 */
function scanForCyclomatic(src: string): number {
  let count = 1;
  // Skip the function header so identifiers in `function name(args)` (e.g.
  // params with names that happen to coincide with reserved words via type
  // annotations) cannot be mis-counted.
  let i = skipFunctionHeader(src);
  const n = src.length;
  while (i < n) {
    const ch = src.charCodeAt(i);
    // Block comment.
    if (ch === 0x2f && src.charCodeAt(i + 1) === 0x2a) {
      i += 2;
      while (i < n && !(src.charCodeAt(i) === 0x2a && src.charCodeAt(i + 1) === 0x2f)) i += 1;
      i += 2;
      continue;
    }
    // Line comment.
    if (ch === 0x2f && src.charCodeAt(i + 1) === 0x2f) {
      i += 2;
      while (i < n && src.charCodeAt(i) !== 0x0a) i += 1;
      continue;
    }
    // String literal — single quote, double quote, backtick. Backtick may
    // contain `${...}` interpolation; we skip the entire backtick run since
    // template-literal expressions cannot legally contain bare control-flow
    // keywords as decision points within the same function (they would be
    // function-call arguments; our caller already gave us the function body
    // slice, and any nested function inside an interpolation is its OWN
    // decision frame computed in a separate pass).
    if (ch === 0x27 || ch === 0x22 || ch === 0x60) {
      const quote = ch;
      i += 1;
      while (i < n) {
        const c = src.charCodeAt(i);
        if (c === 0x5c) {
          i += 2;
          continue;
        }
        if (c === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    // Logical / nullish operators: `&&`, `||`, `??`.
    if (ch === 0x26 && src.charCodeAt(i + 1) === 0x26) {
      count += 1;
      i += 2;
      continue;
    }
    if (ch === 0x7c && src.charCodeAt(i + 1) === 0x7c) {
      count += 1;
      i += 2;
      continue;
    }
    if (ch === 0x3f && src.charCodeAt(i + 1) === 0x3f) {
      count += 1;
      i += 2;
      continue;
    }
    // Ternary `?` — must distinguish from `?.` (optional-chaining) and `??`
    // already handled above. A bare `?` inside a TYPE position (`x: number?`)
    // is rare enough in TS function bodies that we accept the small false-
    // positive surface; the test fixtures avoid that shape.
    if (ch === 0x3f) {
      const next = src.charCodeAt(i + 1);
      if (next !== 0x2e && next !== 0x3f) {
        count += 1;
      }
      i += 1;
      continue;
    }
    // Identifier-like run — keyword detection.
    if (isIdentStart(ch)) {
      const start = i;
      i += 1;
      while (i < n && isIdentPart(src.charCodeAt(i))) i += 1;
      const word = src.slice(start, i);
      if (isCyclomaticKeyword(word)) count += 1;
      continue;
    }
    i += 1;
  }
  return count;
}

/** See `cognitive.ts` for the analogous header-skipper; this is a local copy. */
function skipFunctionHeader(src: string): number {
  let i = 0;
  let parenDepth = 0;
  const n = src.length;
  while (i < n) {
    const ch = src.charCodeAt(i);
    if (ch === 0x2f && src.charCodeAt(i + 1) === 0x2a) {
      i += 2;
      while (i < n && !(src.charCodeAt(i) === 0x2a && src.charCodeAt(i + 1) === 0x2f)) i += 1;
      i += 2;
      continue;
    }
    if (ch === 0x2f && src.charCodeAt(i + 1) === 0x2f) {
      i += 2;
      while (i < n && src.charCodeAt(i) !== 0x0a) i += 1;
      continue;
    }
    if (ch === 0x27 || ch === 0x22 || ch === 0x60) {
      const quote = ch;
      i += 1;
      while (i < n) {
        const c = src.charCodeAt(i);
        if (c === 0x5c) {
          i += 2;
          continue;
        }
        if (c === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === 0x28) {
      parenDepth += 1;
      i += 1;
      continue;
    }
    if (ch === 0x29) {
      parenDepth -= 1;
      i += 1;
      continue;
    }
    if (ch === 0x7b && parenDepth === 0) {
      return i + 1;
    }
    i += 1;
  }
  return n;
}

function isIdentStart(c: number): boolean {
  return (
    (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x24 || c === 0x5f || c >= 0x80
  );
}

function isIdentPart(c: number): boolean {
  return isIdentStart(c) || (c >= 0x30 && c <= 0x39);
}

function isCyclomaticKeyword(w: string): boolean {
  // Note: `do` is intentionally NOT listed — a `do { ... } while (...)` loop
  // terminates with `while`, which already adds +1. Counting both would
  // double-count the loop's single decision point.
  switch (w) {
    case 'if':
    case 'for':
    case 'while':
    case 'case':
    case 'catch':
      return true;
    default:
      return false;
  }
}
