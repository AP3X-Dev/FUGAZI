/**
 * cognitive.ts — Phase 3c.7 (T078) — Sonar cognitive complexity.
 *
 * Computes Sonar's cognitive complexity for a function-shaped AST node, given
 * the full source text of the enclosing module. The metric grows with both
 * structural breaks and structural nesting:
 *
 *   - +1 for each control-flow break: `if`, `for`, `while`, `do-while`,
 *     `switch`, ternary `? :`, `catch`.
 *   - +N additional nesting bonus where N is the current control-structure
 *     depth (the depth before this break is itself entered).
 *   - +1 for each `&&` / `||` / `??` sequence transition: a contiguous run of
 *     the same operator counts as one; switching operator kind adds another.
 *   - +1 for each call that resolves syntactically to the enclosing function's
 *     own name (a single-name recursion check).
 *   - `else if` is treated as a single +1 with no extra nesting bump.
 *   - Plain `else` adds nothing on its own (the preceding `if` already counted).
 *
 * Implementation strategy mirrors `cyclomatic.ts`: extract the function source
 * slice, strip comments and string literals, and scan tokens linearly. Nesting
 * is tracked via a lightweight stack — we push when entering the body of a
 * control structure and pop at its matching close brace. Object-literal braces
 * are explicitly distinguished from control-body braces so they do NOT inflate
 * nesting (an open brace counts toward depth ONLY when a control keyword is
 * pending acceptance of its body).
 *
 * Determinism (NFR-1): no non-deterministic primitives, no `Set`/`Map`
 * iteration.
 */

import type { FunctionDecl, Statement } from '../ast/kinds.js';

type LogicalOp = 'and' | 'or' | 'nullish' | null;

interface ScanState {
  cognitive: number;
  /** Number of control-structure bodies currently open. */
  depth: number;
  /** Brace-depth stack. Each frame says whether a `{` was a CONTROL body. */
  readonly braceStack: ('control' | 'plain' | 'do')[];
  /** When set, the next `{` we see opens a control body and bumps depth. */
  pendingControlBody: boolean;
  /** When set, the next `{` we see opens a do-while body. */
  pendingDoBody: boolean;
  /** When set, the next `while` keyword is the do-while terminator and is suppressed. */
  expectDoWhileTerminator: boolean;
  /** Last logical operator seen in the current contiguous run (null when no run is active). */
  lastLogical: LogicalOp;
  /** Was the most recent identifier-token an `else`? Used to recognise `else if`. */
  lastWordWasElse: boolean;
}

/**
 * Compute Sonar cognitive complexity for a function-shaped AST node, given
 * the full source text of the enclosing module. Non-function statements
 * collapse to 0.
 */
export function computeCognitive(node: FunctionDecl | Statement, source: string): number {
  if (node.kind !== 'FunctionDecl') return 0;
  const slice = sliceRange(source, node.range.start.byteOffset, node.range.end.byteOffset);
  const fnName = node.name ?? '';
  return scanForCognitive(slice, fnName);
}

function sliceRange(source: string, startByte: number, endByte: number): string {
  const start = Math.max(0, Math.min(source.length, startByte));
  const end = Math.max(start, Math.min(source.length, endByte));
  return source.slice(start, end);
}

function scanForCognitive(src: string, fnName: string): number {
  const state: ScanState = {
    cognitive: 0,
    depth: 0,
    braceStack: [],
    pendingControlBody: false,
    pendingDoBody: false,
    expectDoWhileTerminator: false,
    lastLogical: null,
    lastWordWasElse: false,
  };
  // Skip the function header `function name(args)` up to and including the
  // opening `{` of the body. The header may contain default-parameter values
  // with logical operators or ternaries that would otherwise be mis-counted.
  // Conservative approach: skip up to the first `{` outside any `(` group,
  // skipping over strings, regex-likes, and template literals.
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
    // String literals (single, double, backtick). We treat them as opaque —
    // any decision-shaped operator inside is part of the string payload.
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
      state.lastLogical = null;
      state.lastWordWasElse = false;
      continue;
    }
    // Open-brace — consume pending-control or pending-do-body flag if set.
    if (ch === 0x7b) {
      if (state.pendingDoBody) {
        state.braceStack.push('do');
        state.depth += 1;
        state.pendingDoBody = false;
      } else if (state.pendingControlBody) {
        state.braceStack.push('control');
        state.depth += 1;
        state.pendingControlBody = false;
      } else {
        state.braceStack.push('plain');
      }
      state.lastLogical = null;
      state.lastWordWasElse = false;
      i += 1;
      continue;
    }
    if (ch === 0x7d) {
      const top = state.braceStack.pop();
      if (top === 'control') state.depth -= 1;
      if (top === 'do') {
        state.depth -= 1;
        state.expectDoWhileTerminator = true;
      }
      state.lastLogical = null;
      state.lastWordWasElse = false;
      i += 1;
      continue;
    }
    // Logical / nullish operators.
    if (ch === 0x26 && src.charCodeAt(i + 1) === 0x26) {
      noteLogical(state, 'and');
      i += 2;
      continue;
    }
    if (ch === 0x7c && src.charCodeAt(i + 1) === 0x7c) {
      noteLogical(state, 'or');
      i += 2;
      continue;
    }
    if (ch === 0x3f && src.charCodeAt(i + 1) === 0x3f) {
      noteLogical(state, 'nullish');
      i += 2;
      continue;
    }
    // Ternary — distinguish from `?.` and (already-consumed) `??`.
    if (ch === 0x3f) {
      const next = src.charCodeAt(i + 1);
      if (next !== 0x2e && next !== 0x3f) {
        state.cognitive += 1 + state.depth;
        state.lastLogical = null;
      }
      state.lastWordWasElse = false;
      i += 1;
      continue;
    }
    // Identifier-like run.
    if (isIdentStart(ch)) {
      const start = i;
      i += 1;
      while (i < n && isIdentPart(src.charCodeAt(i))) i += 1;
      const word = src.slice(start, i);
      handleWord(state, word, fnName, src, i);
      continue;
    }
    i += 1;
  }
  return Math.max(0, state.cognitive);
}

function handleWord(
  state: ScanState,
  word: string,
  fnName: string,
  src: string,
  cursorAfterWord: number,
): void {
  // `else` followed by `if` collapses to a single +1 with no extra nesting.
  if (word === 'else') {
    state.lastWordWasElse = true;
    state.lastLogical = null;
    return;
  }
  if (word === 'if') {
    if (state.lastWordWasElse) {
      // `else if` — flat +1, no nesting bonus, no depth bump.
      state.cognitive += 1;
      state.pendingControlBody = true;
      state.lastWordWasElse = false;
    } else {
      state.cognitive += 1 + state.depth;
      state.pendingControlBody = true;
    }
    state.lastLogical = null;
    return;
  }
  if (word === 'while') {
    if (state.expectDoWhileTerminator) {
      // Trailing `while (cond)` of a `do { ... } while (cond)` — already
      // counted at the `do` keyword. Consume without incrementing.
      state.expectDoWhileTerminator = false;
      state.lastLogical = null;
      state.lastWordWasElse = false;
      return;
    }
    state.cognitive += 1 + state.depth;
    state.pendingControlBody = true;
    state.lastLogical = null;
    state.lastWordWasElse = false;
    return;
  }
  if (word === 'for' || word === 'switch') {
    state.cognitive += 1 + state.depth;
    state.pendingControlBody = true;
    state.lastLogical = null;
    state.lastWordWasElse = false;
    return;
  }
  if (word === 'do') {
    // do-while: the `do { ... } while (cond)` form. We bump on `do` itself.
    // The trailing `while` is suppressed via `expectDoWhileTerminator` once
    // we close the do-body brace.
    state.cognitive += 1 + state.depth;
    state.pendingDoBody = true;
    state.lastLogical = null;
    state.lastWordWasElse = false;
    return;
  }
  if (word === 'catch') {
    state.cognitive += 1 + state.depth;
    state.pendingControlBody = true;
    state.lastLogical = null;
    state.lastWordWasElse = false;
    return;
  }
  // Recursion: bare call to the enclosing function's own name. We accept any
  // identifier match followed (after optional whitespace) by `(` — generic
  // arguments `<...>` are also tolerated.
  if (fnName !== '' && word === fnName && looksLikeCall(src, cursorAfterWord)) {
    state.cognitive += 1;
  }
  state.lastLogical = null;
  state.lastWordWasElse = false;
}

function looksLikeCall(src: string, from: number): boolean {
  let i = from;
  const n = src.length;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
      i += 1;
      continue;
    }
    if (c === 0x28) return true;
    return false;
  }
  return false;
}

function noteLogical(state: ScanState, op: LogicalOp): void {
  if (state.lastLogical === null || state.lastLogical !== op) {
    state.cognitive += 1;
    state.lastLogical = op;
  }
  state.lastWordWasElse = false;
}

/**
 * Locate the first `{` that opens the function body, skipping over the
 * `function name(params)` header. Tracks paren depth so a `{` inside a default
 * argument's object literal is not mistaken for the body brace. Returns the
 * index immediately AFTER the opening body brace (so the caller starts inside
 * the function body at depth 0).
 */
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
