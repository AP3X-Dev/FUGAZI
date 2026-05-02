/**
 * tokenize tests — Phase 3f.4 Wave A.
 *
 * Exercises the regex-vs-divide heuristic, comment stripping, string-quote
 * normalization, template handling, numeric literal forms, and fail-soft
 * recovery on unterminated input. Every test is in-memory — no fixtures.
 */

import { describe, expect, it } from 'vitest';
import { tokenize } from '../tokenize.js';
import type { Token } from '../types.js';

const summarize = (tokens: readonly Token[]): readonly [string, string][] =>
  tokens.map((t) => [t.kind, t.value]);

describe('tokenize', () => {
  it('(a) basic identifiers, keywords, punct', () => {
    const out = tokenize('/a.ts', 'function foo(x) { return x + 1 }');
    expect(summarize(out.tokens)).toEqual([
      ['keyword', 'function'],
      ['identifier', 'foo'],
      ['punct', '('],
      ['identifier', 'x'],
      ['punct', ')'],
      ['punct', '{'],
      ['keyword', 'return'],
      ['identifier', 'x'],
      ['punct', '+'],
      ['number', '1'],
      ['punct', '}'],
    ]);
  });

  it('(b) string literal stripped of quotes', () => {
    const single = tokenize('/a.ts', "const x = 'foo';");
    const dbl = tokenize('/a.ts', 'const x = "foo";');
    const sStr = single.tokens.find((t) => t.kind === 'string');
    const dStr = dbl.tokens.find((t) => t.kind === 'string');
    expect(sStr?.value).toBe('foo');
    expect(dStr?.value).toBe('foo');
    expect(sStr?.value).toBe(dStr?.value);
    // byteLength includes the quotes
    expect(sStr?.byteLength).toBe(5);
  });

  it('(c) template literal as one token (interpolations included verbatim)', () => {
    const out = tokenize('/a.ts', 'const t = `hello ${name} world`;');
    const tmpl = out.tokens.find((t) => t.kind === 'template');
    expect(tmpl?.value).toBe('`hello ${name} world`');
    // exactly one `template` token
    expect(out.tokens.filter((t) => t.kind === 'template')).toHaveLength(1);
  });

  it('(d) line and block comments stripped', () => {
    const out = tokenize(
      '/a.ts',
      ['// leading line comment', '/* block', '   comment */', 'const x = 1; // trailing'].join(
        '\n',
      ),
    );
    expect(out.tokens.some((t) => t.kind === 'comment')).toBe(false);
    expect(summarize(out.tokens)).toEqual([
      ['keyword', 'const'],
      ['identifier', 'x'],
      ['punct', '='],
      ['number', '1'],
      ['punct', ';'],
    ]);
  });

  it('(e) regex literal `const r = /[a-z]+/g`', () => {
    const out = tokenize('/a.ts', 'const r = /[a-z]+/g');
    const rx = out.tokens.find((t) => t.kind === 'regex');
    expect(rx?.value).toBe('/[a-z]+/g');
  });

  it('(f) regex-vs-divide heuristic — `a / b` is two punct tokens (division)', () => {
    const out = tokenize('/a.ts', 'a / b');
    expect(summarize(out.tokens)).toEqual([
      ['identifier', 'a'],
      ['punct', '/'],
      ['identifier', 'b'],
    ]);
  });

  it('(f2) `(a) / b` — post-paren is also division', () => {
    const out = tokenize('/a.ts', '(a) / b');
    // Known limitation documented in tokenize.ts: the heuristic treats `)`
    // as ending an expression, so `/` is division here. Good.
    const slashes = out.tokens.filter((t) => t.kind === 'punct' && t.value === '/');
    expect(slashes).toHaveLength(1);
    expect(out.tokens.some((t) => t.kind === 'regex')).toBe(false);
  });

  it('(f3) `return /x/g` — regex after return', () => {
    const out = tokenize('/a.ts', 'return /x/g');
    const rx = out.tokens.find((t) => t.kind === 'regex');
    expect(rx?.value).toBe('/x/g');
  });

  it('(g) numeric literals (int, float, hex, scientific)', () => {
    const out = tokenize('/a.ts', '1 1.5 0xFF 1e10 2.5e-3 0b1010 0o77 100n');
    const nums = out.tokens.filter((t) => t.kind === 'number').map((t) => t.value);
    expect(nums).toEqual(['1', '1.5', '0xFF', '1e10', '2.5e-3', '0b1010', '0o77', '100n']);
  });

  it('(h) unterminated string recovers at newline (no throw)', () => {
    expect(() => tokenize('/a.ts', "const x = 'foo\nconst y = 1;")).not.toThrow();
    const out = tokenize('/a.ts', "const x = 'foo\nconst y = 1;");
    // we should still get a `const y` declaration tokenized after recovery
    expect(out.tokens.some((t) => t.kind === 'identifier' && t.value === 'y')).toBe(true);
  });

  it('(h2) unterminated block comment recovers at EOF', () => {
    expect(() => tokenize('/a.ts', 'const x = 1; /* unterminated')).not.toThrow();
    const out = tokenize('/a.ts', 'const x = 1; /* unterminated');
    expect(out.tokens.map((t) => t.value)).toContain('x');
  });

  it('(h3) unterminated template recovers at EOF', () => {
    expect(() => tokenize('/a.ts', 'const t = `hello')).not.toThrow();
  });

  it('byteOffset/byteLength point back at the original source', () => {
    const src = 'const x = 1;';
    const out = tokenize('/a.ts', src);
    for (const tok of out.tokens) {
      const slice = src.slice(tok.byteOffset, tok.byteOffset + tok.byteLength);
      // For strings the slice contains quotes; for everything else the slice
      // equals the value.
      if (tok.kind !== 'string') expect(slice).toBe(tok.value);
    }
  });

  it('TokenStream is frozen + comment-free', () => {
    const out = tokenize('/a.ts', 'const x = 1; // c');
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.tokens)).toBe(true);
    expect(out.tokens.some((t) => t.kind === 'comment')).toBe(false);
  });

  it('multi-char punct: `===`, `!==`, `=>`, `?.`, `??`, `...`', () => {
    const out = tokenize('/a.ts', 'a === b !== c => d?.e ?? f ...g');
    const puncts = out.tokens.filter((t) => t.kind === 'punct').map((t) => t.value);
    expect(puncts).toEqual(['===', '!==', '=>', '?.', '??', '...']);
  });
});
