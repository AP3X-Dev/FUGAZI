/**
 * mi.ts — Phase 3c.7 (T078) — Maintainability Index.
 *
 * Computes the standard normalised maintainability index in the range
 * `[0, 100]`:
 *
 *     MI = MAX(0, (171 - 5.2*ln(V) - 0.23*CC - 16.2*ln(LOC)) * 100 / 171)
 *
 * `V` is the Halstead Volume of the function body. We use a deliberately
 * simplified Halstead approximation:
 *
 *     V = (n1 + n2) * log2(n1 + n2)
 *
 * where `n1` is the count of distinct operator tokens and `n2` is the count of
 * distinct operand tokens encountered while scanning the function source. This
 * is NOT the full classical Halstead formulation (which uses N1 + N2 total
 * counts in the leading factor); the simplified form is sufficient for
 * relative comparison across functions and avoids the complexity of a full
 * lexical Halstead implementation. If the scan yields zero operators (e.g. the
 * function body is purely a return literal), we fall back to
 * `V = max(1, LOC * 4)` so the logarithm remains finite.
 *
 * `LOC` is the count of lines within the function's source range that contain
 * at least one non-whitespace character.
 *
 * `CC` is the cyclomatic complexity (passed in by the caller).
 *
 * Determinism (NFR-1): the result is rounded to 6 decimal places via
 * `Number(x.toFixed(6))`, ensuring byte-equal serialised output across runs.
 */

/**
 * Maintainability Index from Halstead Volume, cyclomatic complexity, and LOC.
 * Returns a value in `[0, 100]` rounded to 6 decimal places.
 */
export function computeMi(volume: number, cyclomatic: number, loc: number): number {
  const v = volume > 0 ? volume : 1;
  const l = loc > 0 ? loc : 1;
  const raw = ((171 - 5.2 * Math.log(v) - 0.23 * cyclomatic - 16.2 * Math.log(l)) * 100) / 171;
  const clamped = Math.max(0, Math.min(100, raw));
  return Number(clamped.toFixed(6));
}

/**
 * Approximate Halstead Volume from a function source slice. Counts distinct
 * operator and operand tokens in a single pass, then returns
 * `(n1 + n2) * log2(n1 + n2)`. Returns `0` when the slice is empty or
 * contains no recognised tokens (the caller substitutes a defensive fallback).
 */
export function approximateHalsteadVolume(src: string): number {
  const operators: Record<string, true> = Object.create(null) as Record<string, true>;
  const operands: Record<string, true> = Object.create(null) as Record<string, true>;
  let n1 = 0;
  let n2 = 0;

  function addOperator(tok: string): void {
    if (operators[tok] === undefined) {
      operators[tok] = true;
      n1 += 1;
    }
  }
  function addOperand(tok: string): void {
    if (operands[tok] === undefined) {
      operands[tok] = true;
      n2 += 1;
    }
  }

  let i = 0;
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
    // String literal — count the quote pair as a single operator token, the
    // payload as one operand. Avoids double-counting characters inside.
    if (ch === 0x27 || ch === 0x22 || ch === 0x60) {
      const quote = ch;
      const startQuote = i;
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
      addOperator(src.charAt(startQuote));
      addOperand(src.slice(startQuote, i));
      continue;
    }
    // Whitespace.
    if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) {
      i += 1;
      continue;
    }
    // Numeric literal.
    if (ch >= 0x30 && ch <= 0x39) {
      const start = i;
      i += 1;
      while (i < n && isNumPart(src.charCodeAt(i))) i += 1;
      addOperand(src.slice(start, i));
      continue;
    }
    // Identifier-like — keywords go to operators, names go to operands.
    if (isIdentStart(ch)) {
      const start = i;
      i += 1;
      while (i < n && isIdentPart(src.charCodeAt(i))) i += 1;
      const word = src.slice(start, i);
      if (isKeywordOperator(word)) addOperator(word);
      else addOperand(word);
      continue;
    }
    // Punctuator — try to greedily match the longest known operator.
    const op = readOperator(src, i);
    if (op !== null) {
      addOperator(op);
      i += op.length;
      continue;
    }
    i += 1;
  }

  const total = n1 + n2;
  if (total === 0) return 0;
  return total * Math.log2(total);
}

function readOperator(src: string, i: number): string | null {
  // Try 3-char, 2-char, 1-char operators in priority order.
  const three = src.slice(i, i + 3);
  if (
    three === '===' ||
    three === '!==' ||
    three === '**=' ||
    three === '<<=' ||
    three === '>>=' ||
    three === '...' ||
    three === '&&=' ||
    three === '||=' ||
    three === '??='
  ) {
    return three;
  }
  const two = src.slice(i, i + 2);
  if (
    two === '==' ||
    two === '!=' ||
    two === '<=' ||
    two === '>=' ||
    two === '&&' ||
    two === '||' ||
    two === '??' ||
    two === '?.' ||
    two === '=>' ||
    two === '+=' ||
    two === '-=' ||
    two === '*=' ||
    two === '/=' ||
    two === '%=' ||
    two === '**' ||
    two === '<<' ||
    two === '>>' ||
    two === '++' ||
    two === '--'
  ) {
    return two;
  }
  const one = src.charAt(i);
  if (
    one === '+' ||
    one === '-' ||
    one === '*' ||
    one === '/' ||
    one === '%' ||
    one === '=' ||
    one === '<' ||
    one === '>' ||
    one === '!' ||
    one === '~' ||
    one === '&' ||
    one === '|' ||
    one === '^' ||
    one === '?' ||
    one === ':' ||
    one === ',' ||
    one === ';' ||
    one === '.' ||
    one === '(' ||
    one === ')' ||
    one === '[' ||
    one === ']' ||
    one === '{' ||
    one === '}'
  ) {
    return one;
  }
  return null;
}

function isKeywordOperator(w: string): boolean {
  switch (w) {
    case 'if':
    case 'else':
    case 'for':
    case 'while':
    case 'do':
    case 'switch':
    case 'case':
    case 'default':
    case 'break':
    case 'continue':
    case 'return':
    case 'try':
    case 'catch':
    case 'finally':
    case 'throw':
    case 'function':
    case 'class':
    case 'const':
    case 'let':
    case 'var':
    case 'new':
    case 'typeof':
    case 'instanceof':
    case 'in':
    case 'of':
    case 'this':
    case 'super':
    case 'void':
    case 'delete':
    case 'yield':
    case 'await':
    case 'async':
      return true;
    default:
      return false;
  }
}

function isIdentStart(c: number): boolean {
  return (
    (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x24 || c === 0x5f || c >= 0x80
  );
}

function isIdentPart(c: number): boolean {
  return isIdentStart(c) || (c >= 0x30 && c <= 0x39);
}

function isNumPart(c: number): boolean {
  return (
    (c >= 0x30 && c <= 0x39) ||
    c === 0x2e ||
    c === 0x65 ||
    c === 0x45 ||
    c === 0x78 ||
    c === 0x58 ||
    c === 0x5f ||
    c === 0x6e
  );
}

/**
 * Count non-blank lines in `source` between 1-based `startLine` and `endLine`
 * inclusive. Returns the count (always >= 1 when the range contains at least
 * one character; clamped against source bounds).
 */
export function countNonBlankLines(source: string, startLine: number, endLine: number): number {
  if (source.length === 0) return 0;
  const lines = source.split(/\r?\n/);
  const lo = Math.max(1, startLine);
  const hi = Math.min(lines.length, endLine);
  let count = 0;
  for (let i = lo - 1; i <= hi - 1; i += 1) {
    const line = lines[i] ?? '';
    if (/\S/.test(line)) count += 1;
  }
  return count;
}
