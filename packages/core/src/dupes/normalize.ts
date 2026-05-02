/**
 * dupes/normalize.ts — Phase 3f.4 Wave B.
 *
 * Token-stream normalization passes that feed the Type-2 / Type-3 / Type-4
 * detectors. The detectors themselves reuse the Type-1 suffix-array engine
 * unchanged — Type-2/3/4 differ only in WHAT TOKENS the engine sees.
 *
 * Three passes:
 *
 *   - `normalizeForType2(stream)` — collapse every `identifier` token to the
 *     anonymous tag `IDENT`. `function foo(a){return a+1}` and
 *     `function bar(b){return b+1}` then tokenize identically. Keywords,
 *     punctuation, strings, numbers, regex and templates are kept verbatim.
 *
 *   - `normalizeForType3(stream)` — same identifier collapse as Type-2. The
 *     Type-3 detector differs in DETECTION (windowed dilation around Type-2
 *     hits), not in tokens.
 *
 *   - `normalizeForType4(stream)` — apply two AST-flavoured rewrites at the
 *     token-stream level BEFORE the Type-2 collapse, so semantically
 *     equivalent rephrasings collapse to a canonical form:
 *
 *       Rewrite 1 — `for(init; test; update) BODY` ↔
 *                   `init; while(test){ BODY; update; }`
 *           Canonical form: the FOR loop. Detectable while-form blocks are
 *           rewritten to the for-form. We pick the for-form because it is the
 *           more constrained pattern (we can recognize a while-loop preceded
 *           by a single statement and followed by the update at the end of the
 *           body more reliably than the reverse rewrite).
 *
 *       Rewrite 2 — `if (x) return y; return z;` ↔ `return x ? y : z;`
 *           Canonical form: the early-return / IF-RETURN form. Conditional
 *           expressions of the form `return x ? y : z;` are rewritten to the
 *           IF-RETURN form. We pick this form because the detector for
 *           `?:` -in-return is unambiguous: a `return` followed by an
 *           expression then `?` then expression then `:` then expression then
 *           `;` is unmistakable, while detecting an arbitrary IF-RETURN is
 *           equally unambiguous (`if`, `(`, ..., `)`, `return`, ..., `;`,
 *           `return`, ..., `;`).
 *
 *     Both rewrites are best-effort and conservative: any pattern that does
 *     not match exactly is left untouched. Combined with the Type-2 collapse
 *     this means a Type-4 family is reported only when the rewriting brings
 *     two snippets to byte-equal token streams.
 *
 * All passes return a new `TokenStream`. The caller's stream is not mutated.
 * Token `byteOffset` / `byteLength` are PRESERVED on tokens that survive the
 * pass — the detector relies on them for byte-range reconstruction. Tokens
 * synthesized by the Type-4 rewrite reuse the byteOffset of the matched
 * source span so reporters still highlight the original source.
 */

import type { Token, TokenStream } from './types.js';

/** Anonymous identifier tag — every identifier collapses to this value. */
const IDENT_TAG = 'IDENT';

/**
 * `normalizeForType2` — collapse identifier values to `IDENT`. Other token
 * kinds pass through unchanged.
 */
export function normalizeForType2(stream: TokenStream): TokenStream {
  const out: Token[] = [];
  for (const tok of stream.tokens) {
    if (tok.kind === 'identifier') {
      out.push(
        Object.freeze({
          kind: 'identifier',
          value: IDENT_TAG,
          byteOffset: tok.byteOffset,
          byteLength: tok.byteLength,
        }),
      );
    } else {
      out.push(tok);
    }
  }
  return Object.freeze({ file: stream.file, tokens: Object.freeze(out) });
}

/**
 * `normalizeForType3` — identical to Type-2 normalization. Type-3 detection
 * happens at the engine layer (gap-tolerant dilation), not the normalizer.
 */
export function normalizeForType3(stream: TokenStream): TokenStream {
  return normalizeForType2(stream);
}

/**
 * `normalizeForType4` — apply structural rewrites then Type-2 collapse.
 */
export function normalizeForType4(stream: TokenStream): TokenStream {
  const rewritten = applyStructuralRewrites(stream);
  return normalizeForType2(rewritten);
}

/* -------------------------------------------------------------------------- */
/* Structural rewrites (Type-4)                                               */
/* -------------------------------------------------------------------------- */

function applyStructuralRewrites(stream: TokenStream): TokenStream {
  // Apply the `?:`-return rewrite first, then the while-to-for rewrite. Each
  // produces a new array; both passes are linear.
  const afterTernary = rewriteTernaryReturnToIfReturn(stream.tokens);
  const afterLoop = rewriteWhileToFor(afterTernary);
  return Object.freeze({ file: stream.file, tokens: Object.freeze(afterLoop) });
}

/**
 * Rewrite `return X ? Y : Z ;` → `if ( X ) return Y ; return Z ;`.
 *
 * Recognition: a `return` keyword token, followed by an expression that
 * contains a top-level `?` and `:` punctuator (parenthesis-balanced), and
 * terminated by a `;`. We match by punctuator depth tracking — we don't parse
 * the expressions, we just route them.
 */
function rewriteTernaryReturnToIfReturn(tokens: readonly Token[]): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === undefined) {
      i++;
      continue;
    }
    if (tok.kind === 'keyword' && tok.value === 'return') {
      const match = matchTernaryReturn(tokens, i);
      if (match !== null) {
        const off = tok.byteOffset;
        const len = tok.byteLength;
        // Synthesize: if ( X ) return Y ; return Z ;
        out.push(makeKeyword('if', off, len));
        out.push(makePunct('(', off, len));
        for (const t of match.cond) out.push(t);
        out.push(makePunct(')', off, len));
        out.push(makeKeyword('return', off, len));
        for (const t of match.thenExpr) out.push(t);
        out.push(makePunct(';', off, len));
        out.push(makeKeyword('return', off, len));
        for (const t of match.elseExpr) out.push(t);
        out.push(makePunct(';', off, len));
        i = match.endExclusive;
        continue;
      }
    }
    out.push(tok);
    i++;
  }
  return out;
}

interface TernaryMatch {
  readonly cond: readonly Token[];
  readonly thenExpr: readonly Token[];
  readonly elseExpr: readonly Token[];
  readonly endExclusive: number;
}

function matchTernaryReturn(tokens: readonly Token[], retIdx: number): TernaryMatch | null {
  // Scan from retIdx+1. Walk depth across (), [], {}. At depth 0 record the
  // first `?` and the matching `:` that follows. Stop at the terminating `;`.
  let depth = 0;
  let qIdx = -1;
  let colonIdx = -1;
  let semiIdx = -1;
  for (let j = retIdx + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t === undefined) continue;
    if (t.kind === 'punct') {
      if (t.value === '(' || t.value === '[' || t.value === '{') {
        depth++;
        continue;
      }
      if (t.value === ')' || t.value === ']' || t.value === '}') {
        if (depth === 0) return null; // unbalanced; bail
        depth--;
        continue;
      }
      if (depth === 0 && t.value === '?') {
        if (qIdx === -1) qIdx = j;
        continue;
      }
      if (depth === 0 && t.value === ':' && qIdx !== -1 && colonIdx === -1) {
        colonIdx = j;
        continue;
      }
      if (depth === 0 && t.value === ';') {
        semiIdx = j;
        break;
      }
    }
  }
  if (qIdx === -1 || colonIdx === -1 || semiIdx === -1) return null;
  if (qIdx <= retIdx + 1 || colonIdx <= qIdx + 1 || semiIdx <= colonIdx + 1) return null;
  const cond = tokens.slice(retIdx + 1, qIdx);
  const thenExpr = tokens.slice(qIdx + 1, colonIdx);
  const elseExpr = tokens.slice(colonIdx + 1, semiIdx);
  return { cond, thenExpr, elseExpr, endExclusive: semiIdx + 1 };
}

/**
 * Rewrite `INIT_STMT ; while ( TEST ) { BODY ; UPDATE ; }` →
 *         `for ( INIT ; TEST ; UPDATE ) { BODY }`.
 *
 * Recognition: walk back from a `while` keyword to find a single statement
 * ending in `;`, then walk into the while body and check the last full
 * statement before the closing `}` matches the expected `update;` shape. We
 * keep this conservative: only one initialiser statement (no chained
 * declarators) and a body with at least one statement before the update.
 *
 * For v1, structural complexity makes a fully-general rewrite fragile. We
 * recognise the exact shape `let|const|var IDENT = EXPR ; while (TEST) { ... ;
 * IDENT = EXPR ; }`. Any deviation passes through untouched.
 */
function rewriteWhileToFor(tokens: readonly Token[]): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < tokens.length) {
    const match = matchWhileLoop(tokens, i);
    if (match !== null) {
      const off = tokens[match.initStart]?.byteOffset ?? 0;
      const len = tokens[match.initStart]?.byteLength ?? 0;
      out.push(makeKeyword('for', off, len));
      out.push(makePunct('(', off, len));
      // init tokens (without trailing `;`)
      for (let k = match.initStart; k < match.initSemiIdx; k++) {
        const t = tokens[k];
        if (t !== undefined) out.push(t);
      }
      out.push(makePunct(';', off, len));
      // test tokens
      for (let k = match.testStart; k < match.testEnd; k++) {
        const t = tokens[k];
        if (t !== undefined) out.push(t);
      }
      out.push(makePunct(';', off, len));
      // update tokens (without trailing `;`)
      for (let k = match.updateStart; k < match.updateSemiIdx; k++) {
        const t = tokens[k];
        if (t !== undefined) out.push(t);
      }
      out.push(makePunct(')', off, len));
      out.push(makePunct('{', off, len));
      // body without the trailing update statement
      for (let k = match.bodyStart; k < match.updateStart; k++) {
        const t = tokens[k];
        if (t !== undefined) out.push(t);
      }
      out.push(makePunct('}', off, len));
      i = match.endExclusive;
      continue;
    }
    const t = tokens[i];
    if (t !== undefined) out.push(t);
    i++;
  }
  return out;
}

interface WhileMatch {
  readonly initStart: number;
  readonly initSemiIdx: number;
  readonly testStart: number;
  readonly testEnd: number;
  readonly bodyStart: number;
  readonly updateStart: number;
  readonly updateSemiIdx: number;
  readonly endExclusive: number;
}

function matchWhileLoop(tokens: readonly Token[], start: number): WhileMatch | null {
  // Want: `let|const|var IDENT = ... ; while ( ... ) { ... ; IDENT = ... ; }`
  const initKw = tokens[start];
  if (
    initKw === undefined ||
    initKw.kind !== 'keyword' ||
    (initKw.value !== 'let' && initKw.value !== 'const' && initKw.value !== 'var')
  ) {
    return null;
  }
  // Find the terminating `;` of the init statement at depth 0.
  let depth = 0;
  let initSemiIdx = -1;
  for (let j = start + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t === undefined) continue;
    if (t.kind === 'punct') {
      if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
      else if (t.value === ')' || t.value === ']' || t.value === '}') {
        if (depth === 0) return null;
        depth--;
      } else if (depth === 0 && t.value === ';') {
        initSemiIdx = j;
        break;
      }
    }
  }
  if (initSemiIdx === -1) return null;
  // Next token must be `while`.
  const whileKw = tokens[initSemiIdx + 1];
  if (whileKw === undefined || whileKw.kind !== 'keyword' || whileKw.value !== 'while') {
    return null;
  }
  // `(` then balanced expression then `)`.
  const openParen = tokens[initSemiIdx + 2];
  if (openParen === undefined || openParen.kind !== 'punct' || openParen.value !== '(') {
    return null;
  }
  const testStart = initSemiIdx + 3;
  let pdepth = 1;
  let testEnd = -1;
  let cur = testStart;
  while (cur < tokens.length) {
    const t = tokens[cur];
    if (t === undefined) break;
    if (t.kind === 'punct') {
      if (t.value === '(') pdepth++;
      else if (t.value === ')') {
        pdepth--;
        if (pdepth === 0) {
          testEnd = cur;
          break;
        }
      }
    }
    cur++;
  }
  if (testEnd === -1) return null;
  // Then `{` body `}`.
  const openBrace = tokens[testEnd + 1];
  if (openBrace === undefined || openBrace.kind !== 'punct' || openBrace.value !== '{') {
    return null;
  }
  const bodyStart = testEnd + 2;
  // Find matching `}` at depth 0.
  let bdepth = 1;
  let bodyEnd = -1;
  let bcur = bodyStart;
  while (bcur < tokens.length) {
    const t = tokens[bcur];
    if (t === undefined) break;
    if (t.kind === 'punct') {
      if (t.value === '{') bdepth++;
      else if (t.value === '}') {
        bdepth--;
        if (bdepth === 0) {
          bodyEnd = bcur;
          break;
        }
      }
    }
    bcur++;
  }
  if (bodyEnd === -1) return null;
  // Walk body backwards: the update statement is the LAST `;`-terminated
  // statement at depth 0. Look at tokens[bodyStart..bodyEnd) and find the
  // last `;` at depth 0; the statement starts after the previous `;` (or at
  // bodyStart).
  let depthB = 0;
  let lastSemi = -1;
  let prevSemi = -1;
  for (let k = bodyStart; k < bodyEnd; k++) {
    const t = tokens[k];
    if (t === undefined) continue;
    if (t.kind === 'punct') {
      if (t.value === '(' || t.value === '[' || t.value === '{') depthB++;
      else if (t.value === ')' || t.value === ']' || t.value === '}') {
        if (depthB === 0) return null;
        depthB--;
      } else if (depthB === 0 && t.value === ';') {
        prevSemi = lastSemi;
        lastSemi = k;
      }
    }
  }
  if (lastSemi === -1) return null;
  const updateSemiIdx = lastSemi;
  const updateStart = prevSemi === -1 ? bodyStart : prevSemi + 1;
  if (updateStart >= updateSemiIdx) return null;
  // Require at least one statement before the update (so the loop has a body).
  if (updateStart <= bodyStart) {
    return null;
  }
  return {
    initStart: start,
    initSemiIdx,
    testStart,
    testEnd,
    bodyStart,
    updateStart,
    updateSemiIdx,
    endExclusive: bodyEnd + 1,
  };
}

function makeKeyword(value: string, byteOffset: number, byteLength: number): Token {
  return Object.freeze({ kind: 'keyword' as const, value, byteOffset, byteLength });
}

function makePunct(value: string, byteOffset: number, byteLength: number): Token {
  return Object.freeze({ kind: 'punct' as const, value, byteOffset, byteLength });
}
