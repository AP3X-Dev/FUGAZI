/**
 * normalize tests — Phase 3f.4 Wave B.
 *
 * 6 fixtures: 2 per normalization pass (Type-2, Type-3, Type-4).
 */

import { describe, expect, it } from 'vitest';
import { normalizeForType2, normalizeForType3, normalizeForType4 } from '../normalize.js';
import { tokenize } from '../tokenize.js';

describe('normalizeForType2', () => {
  it('collapses identifier values to IDENT but keeps keywords/punct/numbers', () => {
    const stream = tokenize('/a.ts', 'function foo(a, b) { return a + b; }');
    const norm = normalizeForType2(stream);
    const ids = norm.tokens.filter((t) => t.kind === 'identifier');
    expect(ids.length).toBeGreaterThan(0);
    for (const t of ids) expect(t.value).toBe('IDENT');
    // keywords stay
    const fnKw = norm.tokens.find((t) => t.kind === 'keyword' && t.value === 'function');
    expect(fnKw).toBeDefined();
    // numbers stay verbatim if any
    const stream2 = tokenize('/b.ts', 'const x = 42;');
    const norm2 = normalizeForType2(stream2);
    const num = norm2.tokens.find((t) => t.kind === 'number');
    expect(num?.value).toBe('42');
  });

  it('two functions with renamed params produce identical token streams after normalize', () => {
    const a = normalizeForType2(tokenize('/a.ts', 'function foo(a){return a+1}'));
    const b = normalizeForType2(tokenize('/b.ts', 'function bar(b){return b+1}'));
    const va = a.tokens.map((t) => `${t.kind}:${t.value}`).join('|');
    const vb = b.tokens.map((t) => `${t.kind}:${t.value}`).join('|');
    expect(va).toBe(vb);
  });
});

describe('normalizeForType3', () => {
  it('matches Type-2 normalization byte-for-byte (token kinds + values)', () => {
    const src = 'const x = 1; function f(y){ return y + x; }';
    const t2 = normalizeForType3(tokenize('/a.ts', src));
    const expected = normalizeForType2(tokenize('/a.ts', src));
    expect(t2.tokens.length).toBe(expected.tokens.length);
    for (let i = 0; i < t2.tokens.length; i++) {
      expect(t2.tokens[i]?.kind).toBe(expected.tokens[i]?.kind);
      expect(t2.tokens[i]?.value).toBe(expected.tokens[i]?.value);
    }
  });

  it('preserves byte ranges from input tokens', () => {
    const src = 'function foo() { return 1; }';
    const stream = tokenize('/a.ts', src);
    const norm = normalizeForType3(stream);
    expect(norm.tokens.length).toBe(stream.tokens.length);
    for (let i = 0; i < norm.tokens.length; i++) {
      expect(norm.tokens[i]?.byteOffset).toBe(stream.tokens[i]?.byteOffset);
      expect(norm.tokens[i]?.byteLength).toBe(stream.tokens[i]?.byteLength);
    }
  });
});

describe('normalizeForType4', () => {
  it('rewrites `return x ? y : z;` to the IF-RETURN canonical form', () => {
    const src = 'function f(x, y, z) { return x ? y : z; }';
    const norm = normalizeForType4(tokenize('/a.ts', src));
    const seq = norm.tokens.map((t) => `${t.kind}:${t.value}`);
    // Should contain `if`, `(`, then `return` twice, no `?` or `:` outside
    // pre-existing punct.
    expect(seq).toContain('keyword:if');
    const returns = seq.filter((s) => s === 'keyword:return');
    expect(returns.length).toBe(2);
    // Original ternary `?` was at depth 0 — rewriter consumed it.
    expect(seq.some((s) => s === 'punct:?')).toBe(false);
  });

  it('rewrites `let i = 0; while (i < n) { body; i = i + 1; }` to FOR canonical form', () => {
    const src = 'function f(n) { let i = 0; while (i < n) { doStuff(); i = i + 1; } }';
    const norm = normalizeForType4(tokenize('/a.ts', src));
    const seq = norm.tokens.map((t) => `${t.kind}:${t.value}`);
    // `for` keyword present, no remaining `while` keyword.
    expect(seq).toContain('keyword:for');
    expect(seq).not.toContain('keyword:while');
    // Identifiers collapsed (Type-2 step still runs after rewrite).
    const ids = norm.tokens.filter((t) => t.kind === 'identifier');
    for (const t of ids) expect(t.value).toBe('IDENT');
  });
});
