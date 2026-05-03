/**
 * dupes/tokenize-py.ts — Phase 4c T336.
 *
 * Hand-rolled Python tokenizer for clone detection. Mirrors the discipline
 * of `./tokenize.ts` (TS/JS) but speaks Python's lexical grammar:
 *
 *   - `#`-to-EOL line comments (no block comments — Python uses docstrings).
 *   - String literals: `'...'`, `"..."`, `'''...'''`, `"""..."""`,
 *     including the prefixed flavours: `r`, `b`, `u`, `f`, `rb`, `br`, etc.
 *     For clone detection the prefix is dropped — the token's `value` is
 *     the canonicalized literal text WITHOUT prefix or quotes, so
 *     `'foo'` and `b"foo"` collide.
 *   - F-strings (`f"..."` / `f'''...'''`) tokenize as a single `string`
 *     token whose value is the literal text without the f-prefix or
 *     quotes; embedded `{expr}` blocks are NOT recursed into for v1.
 *   - Numbers: ints (`0x` / `0o` / `0b` / decimal), floats, complex
 *     suffix `j`. Underscores allowed (PEP 515).
 *   - Identifiers / keywords. Keywords come from Python 3.12.
 *   - Punctuators: 1-3 char operators including `:=`, `**=`, `//=`, `@=`.
 *
 * Docstring stripping policy: the FIRST string-literal expression statement
 * appearing as the leading body of the module, function, or class is
 * considered a docstring and skipped — matches PEP 257. We approximate
 * "first body of function/class" via a simple lookback: when the previous
 * non-whitespace, non-comment token is `:` AND the token before that is a
 * `)` (function/method def) OR an identifier (class def header), we
 * recognise the upcoming string as a docstring. Module-level docstrings
 * are detected as a string at offset 0 (or after only whitespace/comments).
 *
 * Behavior is fail-soft: malformed input never throws. Unterminated triple-
 * quoted strings are recovered at EOF; unterminated single-quoted strings
 * are recovered at the next newline.
 *
 * Determinism: identical source produces identical TokenStream across
 * runs; no Date.now / Math.random.
 */

import type { Token, TokenKind, TokenStream } from './types.js';

const PY_KEYWORDS = new Set<string>([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'match',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
  // Soft keywords that act keyword-like at clone-detection grain
  'case',
  'type',
]);

const PY_PUNCT_3 = new Set<string>(['**=', '//=', '...', '>>=', '<<=']);
const PY_PUNCT_2 = new Set<string>([
  '==',
  '!=',
  '<=',
  '>=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '<<',
  '>>',
  '**',
  '//',
  ':=',
  '->',
  '@=',
]);

/**
 * `tokenizePython` — return a `TokenStream` for `source`. Comments and
 * docstrings are stripped at this layer (not surfaced as tokens). Never
 * throws; on malformed input, recovers locally and continues.
 */
export function tokenizePython(file: string, source: string): TokenStream {
  const tokens: Token[] = [];
  const len = source.length;
  let i = 0;
  // Track previous non-whitespace token for docstring detection.
  let prevKind: TokenKind | null = null;
  let prevValue = '';
  // Logical-line tracking for docstring detection. A docstring is the
  // FIRST string at the start of a logical line right after a class /
  // function def colon, or at module start. We detect:
  //   - Module-level: no prior tokens (or only comments).
  //   - Function/class: previous tokens end in `<colon>` immediately
  //     preceded by either `)` (function) or an identifier (class).
  let moduleStart = true;

  // Helper: peek the upcoming character (returns -1 at EOF).
  const peek = (off: number): number => {
    return i + off < len ? source.charCodeAt(i + off) : -1;
  };

  // Helper: emit a token. Updates `prevKind` / `prevValue` and clears
  // moduleStart on first non-whitespace emit.
  const emit = (kind: TokenKind, value: string, start: number, end: number): void => {
    tokens.push({ kind, value, byteOffset: start, byteLength: end - start });
    prevKind = kind;
    prevValue = value;
    moduleStart = false;
  };

  // Helper: should the upcoming string literal be skipped as a docstring?
  // Conditions:
  //   - Module-level: moduleStart is still true (no tokens emitted yet).
  //   - Class/function body: prevKind === 'punct' && prevValue === ':'
  //     AND the token before that ends with `)` or an identifier
  //     (a class header without parens).
  const isDocstringContext = (): boolean => {
    if (moduleStart) return true;
    if (prevKind !== 'punct' || prevValue !== ':') return false;
    // Inspect the token before the `:`. If it's `)` (function), an
    // identifier (class header `class Foo:`), or `]` (rare but legal
    // type-parameter form `class Foo[T]:`), treat the next string as
    // a docstring. The token list is already comment-free so we don't
    // need to skip; the immediate predecessor of `:` is the candidate.
    const tk = tokens[tokens.length - 2];
    if (tk === undefined) return false;
    if (tk.kind === 'punct') {
      return tk.value === ')' || tk.value === ']';
    }
    if (tk.kind === 'identifier') return true;
    return false;
  };

  while (i < len) {
    const ch = source.charCodeAt(i);

    // Whitespace
    if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) {
      i++;
      continue;
    }

    // Line comment `# ...`
    if (ch === 0x23) {
      while (i < len && source.charCodeAt(i) !== 0x0a) i++;
      continue;
    }

    // String literal — possibly with prefix(es): r, R, b, B, u, U, f, F,
    // and combinations (rb, br, fr, rf, etc.). Up to 2 prefix chars.
    const stringInfo = tryReadStringStart(source, i);
    if (stringInfo !== null) {
      const start = i;
      const docstring = isDocstringContext();
      const result = readStringLiteral(source, i, stringInfo);
      i = result.endOffset;
      if (docstring) {
        // Skip — docstring is not surfaced as a token.
        moduleStart = false;
        continue;
      }
      emit('string', result.value, start, i);
      continue;
    }

    // Identifier / keyword: [A-Za-z_][A-Za-z0-9_]*
    if ((ch >= 0x41 && ch <= 0x5a) || (ch >= 0x61 && ch <= 0x7a) || ch === 0x5f) {
      const start = i;
      i++;
      while (i < len) {
        const c = source.charCodeAt(i);
        if (
          (c >= 0x41 && c <= 0x5a) ||
          (c >= 0x61 && c <= 0x7a) ||
          (c >= 0x30 && c <= 0x39) ||
          c === 0x5f
        ) {
          i++;
        } else {
          break;
        }
      }
      const value = source.slice(start, i);
      const kind: TokenKind = PY_KEYWORDS.has(value) ? 'keyword' : 'identifier';
      emit(kind, value, start, i);
      continue;
    }

    // Number: 0x..., 0o..., 0b..., or decimal with optional fraction/exp/j.
    if ((ch >= 0x30 && ch <= 0x39) || (ch === 0x2e && isAsciiDigit(peek(1)))) {
      const start = i;
      if (
        ch === 0x30 &&
        i + 1 < len &&
        (source[i + 1] === 'x' ||
          source[i + 1] === 'X' ||
          source[i + 1] === 'o' ||
          source[i + 1] === 'O' ||
          source[i + 1] === 'b' ||
          source[i + 1] === 'B')
      ) {
        i += 2;
        while (i < len && isHexish(source.charCodeAt(i))) i++;
      } else {
        while (i < len && isAsciiDigitOrUnderscore(source.charCodeAt(i))) i++;
        if (i < len && source.charCodeAt(i) === 0x2e) {
          i++;
          while (i < len && isAsciiDigitOrUnderscore(source.charCodeAt(i))) i++;
        }
        if (i < len && (source.charCodeAt(i) === 0x65 || source.charCodeAt(i) === 0x45)) {
          i++;
          if (i < len && (source.charCodeAt(i) === 0x2b || source.charCodeAt(i) === 0x2d)) i++;
          while (i < len && isAsciiDigitOrUnderscore(source.charCodeAt(i))) i++;
        }
      }
      // Complex suffix `j` / `J`.
      if (i < len && (source.charCodeAt(i) === 0x6a || source.charCodeAt(i) === 0x4a)) i++;
      const value = source.slice(start, i);
      emit('number', value, start, i);
      continue;
    }

    // Punctuator (1-3 char). Try greedy 3-char, then 2-char, then 1-char.
    const tri = source.slice(i, i + 3);
    if (tri.length === 3 && PY_PUNCT_3.has(tri)) {
      emit('punct', tri, i, i + 3);
      i += 3;
      continue;
    }
    const di = source.slice(i, i + 2);
    if (di.length === 2 && PY_PUNCT_2.has(di)) {
      emit('punct', di, i, i + 2);
      i += 2;
      continue;
    }
    const single = source[i] ?? '';
    emit('punct', single, i, i + 1);
    i++;
  }

  return Object.freeze({ file, tokens: Object.freeze(tokens) });
}

interface StringStartInfo {
  /** Number of prefix chars (`r`, `b`, `u`, `f`) consumed before the quote. */
  readonly prefixLen: number;
  /** The opening quote character: `'` or `"`. */
  readonly quote: number;
  /** True if the literal is triple-quoted. */
  readonly triple: boolean;
}

/**
 * Detect a Python string-literal start at `offset`. Returns `null` if
 * `source[offset]` does not begin a string. Recognises the prefix soup:
 * up to 2 prefix chars from the set {r, R, b, B, u, U, f, F}, in any
 * order, before a single or triple quote.
 */
function tryReadStringStart(source: string, offset: number): StringStartInfo | null {
  let p = offset;
  const len = source.length;
  let prefixLen = 0;
  // Up to 2 prefix chars.
  for (let n = 0; n < 2; n++) {
    if (p >= len) return null;
    const c = source.charCodeAt(p);
    if (
      c === 0x72 || // r
      c === 0x52 || // R
      c === 0x62 || // b
      c === 0x42 || // B
      c === 0x75 || // u
      c === 0x55 || // U
      c === 0x66 || // f
      c === 0x46 // F
    ) {
      p++;
      prefixLen++;
    } else {
      break;
    }
  }
  if (p >= len) {
    if (prefixLen === 0) return null;
    return null;
  }
  const q = source.charCodeAt(p);
  if (q !== 0x27 && q !== 0x22) {
    // Not a quote — `r` was an identifier.
    return null;
  }
  // Check triple-quote: same quote char three in a row.
  const triple = p + 2 < len && source.charCodeAt(p + 1) === q && source.charCodeAt(p + 2) === q;
  return { prefixLen, quote: q, triple };
}

interface StringReadResult {
  readonly value: string;
  readonly endOffset: number;
}

/**
 * Consume a Python string literal starting at `offset`. `info` describes
 * the prefix and quoting style detected by `tryReadStringStart`. Returns
 * the canonicalized literal text (without prefix or quotes) and the
 * end offset (exclusive — points just past the closing quote(s)). On
 * unterminated input, recovers at EOL (single-quoted) or EOF (triple-quoted).
 */
function readStringLiteral(
  source: string,
  offset: number,
  info: StringStartInfo,
): StringReadResult {
  const len = source.length;
  let p = offset + info.prefixLen + (info.triple ? 3 : 1);
  const valueStart = p;
  if (info.triple) {
    while (p < len) {
      const c = source.charCodeAt(p);
      if (c === 0x5c && p + 1 < len) {
        p += 2;
        continue;
      }
      if (
        c === info.quote &&
        p + 2 < len &&
        source.charCodeAt(p + 1) === info.quote &&
        source.charCodeAt(p + 2) === info.quote
      ) {
        const value = source.slice(valueStart, p);
        return { value, endOffset: p + 3 };
      }
      p++;
    }
    // Unterminated — recover at EOF.
    return { value: source.slice(valueStart, len), endOffset: len };
  }
  while (p < len) {
    const c = source.charCodeAt(p);
    if (c === 0x5c && p + 1 < len) {
      p += 2;
      continue;
    }
    if (c === 0x0a) {
      // Unterminated single-quote — recover at newline (do NOT consume).
      return { value: source.slice(valueStart, p), endOffset: p };
    }
    if (c === info.quote) {
      const value = source.slice(valueStart, p);
      return { value, endOffset: p + 1 };
    }
    p++;
  }
  return { value: source.slice(valueStart, len), endOffset: len };
}

function isAsciiDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

function isAsciiDigitOrUnderscore(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || c === 0x5f;
}

function isHexish(c: number): boolean {
  return (
    (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66) || c === 0x5f
  );
}

export type { Token, TokenKind, TokenStream } from './types.js';
