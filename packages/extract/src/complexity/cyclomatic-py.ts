/**
 * cyclomatic-py.ts — Phase 4a T309 — McCabe cyclomatic complexity for Python.
 *
 * Mirrors `./cyclomatic.ts` for Python source. The McCabe formula is unchanged
 * (baseline 1 + decision count); only the keyword set differs:
 *
 *   - `if`, `elif`              — each adds 1
 *   - `for`, `while`             — loop heads
 *   - `except`                   — each `except` clause adds 1
 *   - `with`                     — context-manager branch (standard McCabe DOES
 *     count `with` because it carries a runtime branch on context-manager exit)
 *   - `case`                     — each `case` arm adds 1 (`match` itself is the
 *     dispatch; `case` arms are the decisions, parallel to TS `case`)
 *   - `and`, `or`                — boolean short-circuit, each adds 1
 *   - `assert`                   — branches on the predicate, adds 1
 *   - `lambda`                   — separate flow control, adds 1
 *   - comprehension `for` / `if` — each adds 1 (`for x in xs if pred` => +2)
 *
 * `else`, `try`, `match`, `def`, `class`, `pass`, `return`, `break`,
 * `continue`, `import`, `raise`, `yield`, `from` do NOT add — they are not
 * branch decisions.
 *
 * Implementation strategy: extract the function's source slice via its
 * `Range` and run a keyword scanner. Python's lack of braces means we cannot
 * reuse the TS header-skipper trick — instead we accept the function's
 * decorator + `def` header as in-scope; decorators rarely contain decision
 * keywords and the over-counting is bounded.
 *
 * String-literal handling: Python strings come in single (`'`), double (`"`),
 * and triple-quoted forms. The scanner skips all three. Triple-quoted
 * f-strings (`f"""..."""`) are skipped as opaque payloads (interpolation
 * expressions inside contribute zero — same conservative posture as the TS
 * scanner with template literals).
 *
 * Determinism (NFR-1): no non-deterministic primitives. Same input → same
 * count byte-for-byte.
 */

import type { AsyncFunctionDef, FunctionDef, PyStatement } from '../ast/kinds-py.js';

/**
 * Compute McCabe cyclomatic complexity for a Python function-shaped node.
 * Returns the count (always ≥ 1). Non-function statements collapse to 1.
 */
export function computeCyclomaticPy(
  node: FunctionDef | AsyncFunctionDef | PyStatement,
  source: string,
): number {
  if (node.kind !== 'FunctionDef' && node.kind !== 'AsyncFunctionDef') return 1;
  const slice = sliceFunctionBody(source, node.range.start.byteOffset, node.range.end.byteOffset);
  return scanForCyclomatic(slice);
}

function sliceFunctionBody(source: string, startByte: number, endByte: number): string {
  const start = Math.max(0, Math.min(source.length, startByte));
  const end = Math.max(start, Math.min(source.length, endByte));
  return source.slice(start, end);
}

/**
 * Single-pass scanner. Skips comments and string literals (incl. triple-
 * quoted), then increments the running count for each decision keyword.
 */
function scanForCyclomatic(src: string): number {
  let count = 1;
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src.charCodeAt(i);
    // Hash line comment.
    if (ch === 0x23 /* # */) {
      i += 1;
      while (i < n && src.charCodeAt(i) !== 0x0a) i += 1;
      continue;
    }
    // String literal — single, double, or triple-quoted.
    if (ch === 0x27 || ch === 0x22) {
      i = skipString(src, i);
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

/**
 * Skip a string literal starting at `start` (which points at the opening
 * quote). Handles single/double/triple-quoted, raw (`r"..."`), byte (`b"..."`),
 * and f-string (`f"..."`) prefixes — though prefixes have already been
 * consumed by the identifier scanner before this is called. We just skip the
 * closing quote sequence.
 *
 * Returns the index AFTER the closing quote(s).
 */
function skipString(src: string, start: number): number {
  const n = src.length;
  const quote = src.charCodeAt(start);
  // Detect triple-quoted form: three identical quote chars in a row.
  const triple = src.charCodeAt(start + 1) === quote && src.charCodeAt(start + 2) === quote;
  if (triple) {
    let i = start + 3;
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 0x5c /* backslash */) {
        i += 2;
        continue;
      }
      if (c === quote && src.charCodeAt(i + 1) === quote && src.charCodeAt(i + 2) === quote) {
        return i + 3;
      }
      i += 1;
    }
    return n;
  }
  // Single-quoted form.
  let i = start + 1;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 0x5c) {
      i += 2;
      continue;
    }
    if (c === quote) {
      return i + 1;
    }
    if (c === 0x0a) {
      // Unterminated single-line string — bail at newline.
      return i;
    }
    i += 1;
  }
  return n;
}

function isIdentStart(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f || c >= 0x80;
}

function isIdentPart(c: number): boolean {
  return isIdentStart(c) || (c >= 0x30 && c <= 0x39);
}

function isCyclomaticKeyword(w: string): boolean {
  switch (w) {
    case 'if':
    case 'elif':
    case 'for':
    case 'while':
    case 'except':
    case 'with':
    case 'case':
    case 'and':
    case 'or':
    case 'assert':
    case 'lambda':
      return true;
    default:
      return false;
  }
}
