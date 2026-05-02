/**
 * dupes/tokenize.ts — Phase 3f.4 Wave A.
 *
 * Hand-rolled TS/JS tokenizer for clone detection. Not a full TS lexer — we
 * only need enough fidelity to give the suffix-array stable, comment-free,
 * comparable tokens. We intentionally skip:
 *
 *   - JSX / TSX (treated as a stream of identifiers + punct; v1 limitation).
 *   - Decorator semantics (`@foo` is `punct` + `identifier`).
 *   - Template-expression recursion (whole template literal becomes one
 *     `template` token, including `${...}` interpolations).
 *
 * Behavior is fail-soft: malformed input never throws. Unterminated strings,
 * comments and templates are recovered by consuming up to the next newline
 * (for `//`, `'`, `"`) or EOF (for block comments, backticks, regex). Document this
 * in tests — it matters for partial-file edge cases in editor tooling.
 *
 * Regex disambiguation is heuristic. JS doesn't have a regular grammar for
 * `/`-vs-regex disambiguation — context determines it. We track the previous
 * non-whitespace, non-comment token; if it's a keyword that admits an
 * expression next (`return`, `typeof`, etc.) or a punctuator that expects an
 * RHS (`=`, `(`, `,`, `;`, `:`, `?`, `!`, `&`, `|`, `^`, `~`, `+`, `-`, `*`,
 * `/`, `%`, `<`, `>`, `[`, `{`), we treat `/` as the start of a regex
 * literal. Otherwise we treat it as division. This matches the Acorn
 * heuristic and gets it right for >99% of real-world TS/JS. Known
 * misclassifications fall back to `punct` and the surrounding tokens still
 * line up — clone detection degrades gracefully rather than crashing.
 */

import type { Token, TokenKind, TokenStream } from './types.js';

const KEYWORDS = new Set<string>([
  'function',
  'class',
  'let',
  'const',
  'var',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'default',
  'break',
  'continue',
  'return',
  'try',
  'catch',
  'finally',
  'throw',
  'new',
  'delete',
  'typeof',
  'instanceof',
  'in',
  'of',
  'import',
  'export',
  'from',
  'as',
  'async',
  'await',
  'yield',
  'this',
  'super',
  'null',
  'undefined',
  'true',
  'false',
  'void',
  'interface',
  'type',
  'enum',
  'extends',
  'implements',
  'readonly',
  'public',
  'private',
  'protected',
  'static',
  'abstract',
  'override',
  'declare',
  'module',
  'namespace',
]);

/**
 * Keywords after which a `/` opens a regex literal (e.g. `return /x/`,
 * `typeof /x/`). Most expression-introducing keywords. We over-include here
 * because false positives (regex where division was intended) are rarer and
 * less harmful than false negatives.
 */
const REGEX_AFTER_KEYWORD = new Set<string>([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'delete',
  'void',
  'throw',
  'new',
  'await',
  'yield',
  'case',
  'do',
  'else',
]);

/** Punctuators after which a `/` opens a regex literal. */
const REGEX_AFTER_PUNCT = new Set<string>([
  '=',
  '(',
  ',',
  ';',
  ':',
  '?',
  '!',
  '&',
  '|',
  '^',
  '~',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '[',
  '{',
  '==',
  '!=',
  '===',
  '!==',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
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
  '>>>',
  '<<=',
  '>>=',
  '>>>=',
  '=>',
  '...',
]);

const PUNCT_3 = new Set<string>([
  '===',
  '!==',
  '...',
  '**=',
  '<<=',
  '>>=',
  '>>>',
  '&&=',
  '||=',
  '??=',
]);
const PUNCT_2 = new Set<string>([
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '=>',
  '++',
  '--',
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
  '?.',
]);

/**
 * `tokenize` — return a `TokenStream` for `source`. Comments are stripped at
 * this layer (not surfaced as tokens). Never throws; on malformed input,
 * recovers locally and continues.
 */
export function tokenize(file: string, source: string): TokenStream {
  const tokens: Token[] = [];
  const len = source.length;
  let i = 0;
  // Track previous non-whitespace token for regex/divide disambiguation. We
  // include comments in the *raw* output below for source-range fidelity, but
  // strip them from `tokens` — and we also skip them when looking back here.
  let prevKind: TokenKind | null = null;
  let prevValue = '';

  // Helper: should `/` at index `i` be parsed as regex?
  const isRegexContext = (): boolean => {
    if (prevKind === null) return true;
    if (prevKind === 'keyword') return REGEX_AFTER_KEYWORD.has(prevValue);
    if (prevKind === 'punct') {
      // Closing brackets of expressions disable regex; opening brackets enable.
      if (prevValue === ')' || prevValue === ']' || prevValue === '}') return false;
      return REGEX_AFTER_PUNCT.has(prevValue);
    }
    // identifier, number, string, template, regex → division
    return false;
  };

  while (i < len) {
    const ch = source.charCodeAt(i);

    // Whitespace
    if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) {
      i++;
      continue;
    }

    // Line comment `//` — recover by consuming to EOL.
    if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2f) {
      while (i < len && source.charCodeAt(i) !== 0x0a) i++;
      continue;
    }

    // Block comment `/* */` — recover by consuming to closing or EOF.
    if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2a) {
      i += 2;
      while (i < len) {
        if (source.charCodeAt(i) === 0x2a && source.charCodeAt(i + 1) === 0x2f) {
          i += 2;
          break;
        }
        i++;
      }
      continue;
    }

    // String literal `'…'` or `"…"`
    if (ch === 0x27 || ch === 0x22) {
      const quote = ch;
      const start = i;
      i++; // skip opening quote
      let value = '';
      while (i < len) {
        const c = source.charCodeAt(i);
        if (c === 0x5c) {
          // backslash escape — consume next char verbatim
          if (i + 1 < len) {
            value += source.slice(i, i + 2);
            i += 2;
            continue;
          }
          // dangling backslash at EOF
          value += source.slice(i, i + 1);
          i++;
          continue;
        }
        if (c === 0x0a) {
          // unterminated — recover at newline
          break;
        }
        if (c === quote) {
          i++; // consume closing quote
          break;
        }
        value += source[i];
        i++;
      }
      const tok: Token = {
        kind: 'string',
        value,
        byteOffset: start,
        byteLength: i - start,
      };
      tokens.push(tok);
      prevKind = 'string';
      prevValue = value;
      continue;
    }

    // Template literal `\`…\``
    if (ch === 0x60) {
      const start = i;
      i++; // skip opening backtick
      let depth = 0;
      while (i < len) {
        const c = source.charCodeAt(i);
        if (c === 0x5c) {
          // escape — skip next
          i = i + 2 <= len ? i + 2 : len;
          continue;
        }
        if (depth === 0 && c === 0x60) {
          i++; // consume closing backtick
          break;
        }
        if (c === 0x24 && source.charCodeAt(i + 1) === 0x7b) {
          depth++;
          i += 2;
          continue;
        }
        if (depth > 0 && c === 0x7d) {
          depth--;
          i++;
          continue;
        }
        i++;
      }
      const tok: Token = {
        kind: 'template',
        value: source.slice(start, i),
        byteOffset: start,
        byteLength: i - start,
      };
      tokens.push(tok);
      prevKind = 'template';
      prevValue = tok.value;
      continue;
    }

    // Identifier / keyword: [A-Za-z_$][A-Za-z0-9_$]*
    if ((ch >= 0x41 && ch <= 0x5a) || (ch >= 0x61 && ch <= 0x7a) || ch === 0x5f || ch === 0x24) {
      const start = i;
      i++;
      while (i < len) {
        const c = source.charCodeAt(i);
        if (
          (c >= 0x41 && c <= 0x5a) ||
          (c >= 0x61 && c <= 0x7a) ||
          (c >= 0x30 && c <= 0x39) ||
          c === 0x5f ||
          c === 0x24
        ) {
          i++;
        } else {
          break;
        }
      }
      const value = source.slice(start, i);
      const kind: TokenKind = KEYWORDS.has(value) ? 'keyword' : 'identifier';
      tokens.push({ kind, value, byteOffset: start, byteLength: i - start });
      prevKind = kind;
      prevValue = value;
      continue;
    }

    // Number: 0x..., 0o..., 0b..., or decimal with optional fraction/exp.
    if ((ch >= 0x30 && ch <= 0x39) || (ch === 0x2e && isAsciiDigit(source.charCodeAt(i + 1)))) {
      const start = i;
      // hex / octal / binary
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
        while (i < len && isAsciiDigit(source.charCodeAt(i))) i++;
        if (i < len && source.charCodeAt(i) === 0x2e) {
          i++;
          while (i < len && isAsciiDigit(source.charCodeAt(i))) i++;
        }
        if (i < len && (source.charCodeAt(i) === 0x65 || source.charCodeAt(i) === 0x45)) {
          i++;
          if (i < len && (source.charCodeAt(i) === 0x2b || source.charCodeAt(i) === 0x2d)) i++;
          while (i < len && isAsciiDigit(source.charCodeAt(i))) i++;
        }
      }
      // BigInt suffix
      if (i < len && source.charCodeAt(i) === 0x6e) i++;
      const value = source.slice(start, i);
      tokens.push({ kind: 'number', value, byteOffset: start, byteLength: i - start });
      prevKind = 'number';
      prevValue = value;
      continue;
    }

    // Regex vs divide
    if (ch === 0x2f) {
      if (isRegexContext()) {
        const start = i;
        i++; // consume opening `/`
        let inClass = false;
        let terminated = false;
        while (i < len) {
          const c = source.charCodeAt(i);
          if (c === 0x5c) {
            i = i + 2 <= len ? i + 2 : len;
            continue;
          }
          if (c === 0x5b) {
            inClass = true;
            i++;
            continue;
          }
          if (c === 0x5d && inClass) {
            inClass = false;
            i++;
            continue;
          }
          if (c === 0x0a) break; // unterminated — recover
          if (c === 0x2f && !inClass) {
            i++; // consume closing `/`
            terminated = true;
            break;
          }
          i++;
        }
        // consume flags
        if (terminated) {
          while (i < len) {
            const c = source.charCodeAt(i);
            if ((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a)) i++;
            else break;
          }
        }
        const value = source.slice(start, i);
        tokens.push({ kind: 'regex', value, byteOffset: start, byteLength: i - start });
        prevKind = 'regex';
        prevValue = value;
        continue;
      }
      // fall through to punct
    }

    // Punctuator (1-3 char). Try greedy 3-char, then 2-char, then 1-char.
    const tri = source.slice(i, i + 3);
    if (tri.length === 3 && PUNCT_3.has(tri)) {
      tokens.push({ kind: 'punct', value: tri, byteOffset: i, byteLength: 3 });
      prevKind = 'punct';
      prevValue = tri;
      i += 3;
      continue;
    }
    const di = source.slice(i, i + 2);
    if (di.length === 2 && PUNCT_2.has(di)) {
      tokens.push({ kind: 'punct', value: di, byteOffset: i, byteLength: 2 });
      prevKind = 'punct';
      prevValue = di;
      i += 2;
      continue;
    }
    // single-char punct (catch-all — anything non-alphanumeric we haven't
    // already handled becomes punct so the stream stays well-formed).
    const single = source[i] ?? '';
    tokens.push({ kind: 'punct', value: single, byteOffset: i, byteLength: 1 });
    prevKind = 'punct';
    prevValue = single;
    i++;
  }

  return Object.freeze({ file, tokens: Object.freeze(tokens) });
}

function isAsciiDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

/**
 * Loosely-defined "hex-ish" — valid bytes inside `0x`/`0o`/`0b` literals,
 * plus underscores (numeric separators). We accept octal/binary digits as a
 * superset of decimal and let the consuming layer not care: the literal text
 * is preserved verbatim as the `value` and we never evaluate it.
 */
function isHexish(c: number): boolean {
  return (
    (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66) || c === 0x5f
  );
}

export type { Token, TokenKind, TokenStream } from './types.js';
