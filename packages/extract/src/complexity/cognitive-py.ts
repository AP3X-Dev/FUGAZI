/**
 * cognitive-py.ts — Phase 4a T309 — Sonar cognitive complexity for Python.
 *
 * Mirrors `./cognitive.ts` for Python source. Sonar's formula is unchanged:
 *
 *   - +1 for each control-flow break: `if`, `elif`, `for`, `while`, `try`,
 *     `except`, `with`, `match`/`case`, conditional ternary `... if ... else`,
 *     `lambda`.
 *   - +N additional nesting bonus where N is the current control-structure
 *     depth.
 *   - +1 for each `and` / `or` sequence transition (a contiguous run of the
 *     same operator counts as one; switching adds another).
 *   - `elif` is treated as a single +1 with no extra nesting bump (parallel
 *     to TS `else if`).
 *
 * Implementation strategy: Python uses indentation, not braces, so we cannot
 * brace-track nesting. Instead we build the nesting depth from the COLUMN of
 * each block-opening keyword: deeper indentation ⇒ deeper nesting. This is
 * the same trick `cognitive_complexity` (Python implementation) uses.
 *
 * We track:
 *   - `indentStack`: sorted array of column positions of currently-open
 *     block heads. `depth = indentStack.length - 1` (the outermost block at
 *     col 0 is depth 0).
 *   - When we encounter a block-opening keyword (`if`, `elif`, `for`,
 *     `while`, `try`, `except`, `with`, `match`, `case`, `def`, `class`,
 *     `lambda`), we read its line's indentation. If the indentation equals
 *     the top of the stack, the previous frame ends here; if shallower, we
 *     pop frames until indent ≤ top; if deeper, we push.
 *
 * Determinism (NFR-1): no non-deterministic primitives.
 */

import type { AsyncFunctionDef, FunctionDef, PyStatement } from '../ast/kinds-py.js';

type LogicalOp = 'and' | 'or' | null;

interface ScanState {
  cognitive: number;
  /** Indentation columns of currently-open block heads (ascending). */
  readonly indentStack: number[];
  /** Last seen logical operator on the current contiguous run. */
  lastLogical: LogicalOp;
}

/**
 * Compute Sonar cognitive complexity for a Python function-shaped node.
 * Non-function statements collapse to 0.
 */
export function computeCognitivePy(
  node: FunctionDef | AsyncFunctionDef | PyStatement,
  source: string,
): number {
  if (node.kind !== 'FunctionDef' && node.kind !== 'AsyncFunctionDef') return 0;
  const slice = sliceRange(source, node.range.start.byteOffset, node.range.end.byteOffset);
  return scanForCognitive(slice);
}

function sliceRange(source: string, startByte: number, endByte: number): string {
  const start = Math.max(0, Math.min(source.length, startByte));
  const end = Math.max(start, Math.min(source.length, endByte));
  return source.slice(start, end);
}

function scanForCognitive(src: string): number {
  const state: ScanState = {
    cognitive: 0,
    indentStack: [],
    lastLogical: null,
  };
  // We split into lines to get line-leading indentation cheaply. The scanner
  // examines each line for the leading keyword (after whitespace) and the
  // logical operators on the line.
  const lines = src.split(/\r?\n/);
  for (const line of lines) {
    processLine(line, state);
  }
  return Math.max(0, state.cognitive);
}

function processLine(line: string, state: ScanState): void {
  // Compute the line's indentation column (count of leading spaces; tabs
  // count as 1 — matches Python's PEP 8 recommendation of spaces but is
  // robust against tabs in legacy code).
  let col = 0;
  while (col < line.length) {
    const c = line.charCodeAt(col);
    if (c === 0x20 || c === 0x09) col += 1;
    else break;
  }
  if (col === line.length) return; // blank line
  // Strip line comments.
  const hashIdx = findUnquotedHash(line, col);
  const codePart = hashIdx === -1 ? line.slice(col) : line.slice(col, hashIdx);
  if (codePart.length === 0) return;

  // Identify the leading keyword (if any).
  const leadingKeyword = readLeadingKeyword(codePart);
  if (leadingKeyword !== null && isBlockOpener(leadingKeyword)) {
    // Adjust the indent stack against `col`.
    adjustIndentStack(state, col);
    const depth = state.indentStack.length;
    if (leadingKeyword === 'elif') {
      // +1 with no nesting bump (parallel to TS `else if`).
      state.cognitive += 1;
    } else if (leadingKeyword === 'else') {
      // +0 — the preceding `if` already counted.
    } else if (countsForCognitive(leadingKeyword)) {
      state.cognitive += 1 + depth;
    }
    // `def`, `class`, `async` are the function/class headers — they DO open
    // a block but they themselves are the function-scope baseline (depth 0
    // inside the body). Skip pushing them so an `if` immediately inside
    // sees depth 0, not depth 1.
    if (leadingKeyword !== 'def' && leadingKeyword !== 'class' && leadingKeyword !== 'async') {
      state.indentStack.push(col);
    }
    // Continue scanning the rest of the line for inline operators.
  } else if (leadingKeyword !== null) {
    // Non-block leading keyword (`return`, `pass`, ...) — still adjust the
    // indent stack so subsequent block openers see the correct depth.
    adjustIndentStack(state, col);
  } else {
    adjustIndentStack(state, col);
  }

  // Inline scan for `and`/`or`/`lambda`/conditional-ternary.
  scanInlineTokens(codePart, state);
}

function adjustIndentStack(state: ScanState, col: number): void {
  while (state.indentStack.length > 0) {
    const top = state.indentStack[state.indentStack.length - 1];
    if (top !== undefined && top >= col) {
      state.indentStack.pop();
      continue;
    }
    break;
  }
}

function readLeadingKeyword(codePart: string): string | null {
  if (codePart.length === 0) return null;
  const c = codePart.charCodeAt(0);
  if (!isIdentStart(c)) return null;
  let i = 1;
  while (i < codePart.length && isIdentPart(codePart.charCodeAt(i))) i += 1;
  return codePart.slice(0, i);
}

function isBlockOpener(w: string): boolean {
  switch (w) {
    case 'if':
    case 'elif':
    case 'else':
    case 'for':
    case 'while':
    case 'try':
    case 'except':
    case 'finally':
    case 'with':
    case 'match':
    case 'case':
    case 'def':
    case 'class':
    case 'async':
      return true;
    default:
      return false;
  }
}

function countsForCognitive(w: string): boolean {
  // `try`, `def`, `class`, `match`, `finally`, `async` open blocks but do NOT
  // contribute to cognitive complexity by themselves (only the contained
  // decisions do). `else` is handled separately above.
  switch (w) {
    case 'if':
    case 'for':
    case 'while':
    case 'except':
    case 'with':
    case 'case':
      return true;
    default:
      return false;
  }
}

/**
 * Scan a single line of source code (after stripping the `#` comment tail)
 * for inline tokens that contribute to cognitive complexity:
 *
 *   - `and`, `or`            — logical-operator run boundaries
 *   - `lambda`               — inline function break (+1 + depth)
 *   - inline `if .. else ..` — conditional ternary (+1 + depth)
 *
 * Skips strings and identifier-internal occurrences.
 */
function scanInlineTokens(line: string, state: ScanState): void {
  const n = line.length;
  let i = 0;
  // We don't care about leading-keyword duplication: a line starting with
  // `if x and y:` already counted +1 for the `if`; the `and` adds another +1
  // via the logical-operator path.
  while (i < n) {
    const ch = line.charCodeAt(i);
    if (ch === 0x27 || ch === 0x22) {
      i = skipStringLine(line, i);
      continue;
    }
    if (isIdentStart(ch)) {
      const start = i;
      i += 1;
      while (i < n && isIdentPart(line.charCodeAt(i))) i += 1;
      const word = line.slice(start, i);
      if (word === 'and') {
        noteLogical(state, 'and');
      } else if (word === 'or') {
        noteLogical(state, 'or');
      } else if (word === 'lambda') {
        // Lambda introduces a separate flow control; +1 + depth.
        state.cognitive += 1 + state.indentStack.length;
        state.lastLogical = null;
      } else if (word === 'if' && start > 0) {
        // Inline `if` (i.e. NOT at the leading position) → conditional
        // ternary expression. The surrounding code already started at col;
        // an inline `if` is a ternary contributor.
        const before = line.charCodeAt(start - 1);
        // Only count when preceded by whitespace (rules out `elif` already
        // matched as one token).
        if (before === 0x20 || before === 0x09) {
          state.cognitive += 1 + state.indentStack.length;
          state.lastLogical = null;
        }
      } else {
        state.lastLogical = null;
      }
      continue;
    }
    state.lastLogical = null;
    i += 1;
  }
}

function noteLogical(state: ScanState, op: LogicalOp): void {
  if (state.lastLogical === null || state.lastLogical !== op) {
    state.cognitive += 1;
    state.lastLogical = op;
  }
}

function skipStringLine(line: string, start: number): number {
  // Single-line scope only — triple-quoted strings spanning lines are NOT
  // tracked here; lines INSIDE a docstring would still be processed but
  // their leading-keyword check finds nothing keyword-shaped (the prose
  // inside docstrings doesn't trigger). This is a tolerable v1 imprecision.
  const quote = line.charCodeAt(start);
  let i = start + 1;
  const n = line.length;
  while (i < n) {
    const c = line.charCodeAt(i);
    if (c === 0x5c) {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    i += 1;
  }
  return n;
}

/**
 * Return the index of the first `#` outside a string literal, or -1 when no
 * such `#` exists. Used to strip line-trailing comments before keyword
 * scanning.
 */
function findUnquotedHash(line: string, fromCol: number): number {
  const n = line.length;
  let i = fromCol;
  while (i < n) {
    const c = line.charCodeAt(i);
    if (c === 0x27 || c === 0x22) {
      i = skipStringLine(line, i);
      continue;
    }
    if (c === 0x23) return i;
    i += 1;
  }
  return -1;
}

function isIdentStart(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f || c >= 0x80;
}

function isIdentPart(c: number): boolean {
  return isIdentStart(c) || (c >= 0x30 && c <= 0x39);
}
