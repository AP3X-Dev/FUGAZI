/**
 * tokenize-py.test.ts — Phase 4c T336 acceptance suite.
 *
 * Exercises the hand-rolled Python tokenizer: keyword recognition,
 * comment stripping (`# ...`), docstring stripping (module / class /
 * function leading triple-quoted string), string-prefix handling, number
 * literals (hex / oct / bin / decimal / complex), punctuators (1-3 char
 * including `:=`, `**=`, `//=`).
 */

import { describe, expect, it } from 'vitest';
import { findAllClones, tokenize } from '../index.js';
import { tokenizePython } from '../tokenize-py.js';
import type { Token } from '../types.js';

const summarize = (tokens: readonly Token[]): readonly [string, string][] =>
  tokens.map((t) => [t.kind, t.value]);

describe('tokenizePython', () => {
  it('basic identifiers, keywords, punct', () => {
    const out = tokenizePython('/a.py', 'def foo(x):\n    return x + 1');
    expect(summarize(out.tokens)).toEqual([
      ['keyword', 'def'],
      ['identifier', 'foo'],
      ['punct', '('],
      ['identifier', 'x'],
      ['punct', ')'],
      ['punct', ':'],
      ['keyword', 'return'],
      ['identifier', 'x'],
      ['punct', '+'],
      ['number', '1'],
    ]);
  });

  it('strips line comments', () => {
    const out = tokenizePython('/a.py', '# this is a comment\nx = 1  # trailing\n');
    expect(summarize(out.tokens)).toEqual([
      ['identifier', 'x'],
      ['punct', '='],
      ['number', '1'],
    ]);
  });

  it('strips module-level docstring (first triple-quoted string)', () => {
    const out = tokenizePython('/a.py', `"""Module docstring."""\n\nx = 1\n`);
    expect(summarize(out.tokens)).toEqual([
      ['identifier', 'x'],
      ['punct', '='],
      ['number', '1'],
    ]);
  });

  it('strips function-level docstring', () => {
    const out = tokenizePython('/a.py', `def foo():\n    """fn doc"""\n    return 1\n`);
    // The docstring after `def foo():` is dropped. Remaining tokens are
    // the def header + return + 1.
    const kinds = out.tokens.map((t) => t.kind);
    expect(kinds).not.toContain('string');
    const values = out.tokens.map((t) => t.value);
    expect(values).toEqual(['def', 'foo', '(', ')', ':', 'return', '1']);
  });

  it('strips class-level docstring', () => {
    const out = tokenizePython('/a.py', `class Foo:\n    """class doc"""\n    pass\n`);
    const kinds = out.tokens.map((t) => t.kind);
    expect(kinds).not.toContain('string');
  });

  it('canonicalizes string literals (quote-stripping, prefix-dropping)', () => {
    const single = tokenizePython('/a.py', `x = 'foo'`);
    const dbl = tokenizePython('/a.py', `x = "foo"`);
    const bytes = tokenizePython('/a.py', `x = b'foo'`);
    const fstr = tokenizePython('/a.py', `x = f'foo'`);
    const sStr = single.tokens.find((t) => t.kind === 'string');
    const dStr = dbl.tokens.find((t) => t.kind === 'string');
    const bStr = bytes.tokens.find((t) => t.kind === 'string');
    const fStr = fstr.tokens.find((t) => t.kind === 'string');
    expect(sStr?.value).toBe('foo');
    expect(dStr?.value).toBe('foo');
    expect(bStr?.value).toBe('foo');
    expect(fStr?.value).toBe('foo');
  });

  it('handles triple-quoted strings as docstring (module) and as values (later)', () => {
    const out = tokenizePython('/a.py', `"""docstring"""\nx = """value"""\n`);
    // Docstring stripped; second triple-quoted is a value.
    const stringTokens = out.tokens.filter((t) => t.kind === 'string');
    expect(stringTokens.length).toBe(1);
    expect(stringTokens[0]?.value).toBe('value');
  });

  it('numeric literals: hex, oct, bin, decimal, float, complex', () => {
    const out = tokenizePython(
      '/a.py',
      'a = 0xFF\nb = 0o77\nc = 0b101\nd = 3.14\ne = 1_000\nf = 1.5j',
    );
    const numbers = out.tokens.filter((t) => t.kind === 'number').map((t) => t.value);
    expect(numbers).toEqual(['0xFF', '0o77', '0b101', '3.14', '1_000', '1.5j']);
  });

  it('walrus + power-assign + floor-div-assign punctuators', () => {
    const out = tokenizePython('/a.py', 'if (n := 10) > 5: x **= 2; y //= 3');
    const punct = out.tokens.filter((t) => t.kind === 'punct').map((t) => t.value);
    expect(punct).toContain(':=');
    expect(punct).toContain('**=');
    expect(punct).toContain('//=');
  });

  it('arrow `->` punctuator for return annotations', () => {
    const out = tokenizePython('/a.py', 'def foo() -> int: pass');
    const arrow = out.tokens.find((t) => t.kind === 'punct' && t.value === '->');
    expect(arrow).toBeDefined();
  });

  it('byte offsets are preserved for source-range fidelity', () => {
    const src = 'def foo(): pass';
    const out = tokenizePython('/a.py', src);
    const def = out.tokens[0];
    expect(def?.byteOffset).toBe(0);
    expect(def?.byteLength).toBe(3);
    const foo = out.tokens[1];
    expect(foo?.byteOffset).toBe(4);
  });

  it('determinism: same input → same tokens across runs', () => {
    const src = 'def foo(x: int) -> int:\n    return x * 2\n';
    const a = tokenizePython('/a.py', src);
    const b = tokenizePython('/a.py', src);
    expect(JSON.stringify(a.tokens)).toBe(JSON.stringify(b.tokens));
  });

  it('unterminated single-quoted string recovers at newline', () => {
    const out = tokenizePython('/a.py', `x = 'unterminated\ny = 2`);
    // Should still produce identifiers / numbers after recovery.
    const idents = out.tokens.filter((t) => t.kind === 'identifier').map((t) => t.value);
    expect(idents).toContain('y');
  });
});

describe('code-duplication clones (T336 wired)', () => {
  it('Type-1 clone: identical Python functions in two files', () => {
    const src1 =
      'def process(items):\n    out = []\n    for x in items:\n        if x > 0:\n            out.append(x * 2)\n        else:\n            out.append(0)\n    return out\n';
    const a = tokenizePython('/a.py', src1);
    const b = tokenizePython('/b.py', src1);
    const families = findAllClones([a, b], { minTokens: 10 });
    expect(families.length).toBeGreaterThan(0);
  });

  it('Type-2 clone: renamed identifiers detected', () => {
    const src1 =
      'def foo(items):\n    accumulator = []\n    for item in items:\n        if item > 0:\n            accumulator.append(item * 2)\n        else:\n            accumulator.append(0)\n    return accumulator\n';
    const src2 =
      'def bar(values):\n    result = []\n    for v in values:\n        if v > 0:\n            result.append(v * 2)\n        else:\n            result.append(0)\n    return result\n';
    const a = tokenizePython('/a.py', src1);
    const b = tokenizePython('/b.py', src2);
    const families = findAllClones([a, b], { minTokens: 10 });
    // Renamed identifiers → expect at least one Type-2 family (may also
    // not produce Type-1 since names differ).
    expect(families.some((f) => f.kind === 'type-2' || f.kind === 'type-3')).toBe(true);
  });

  it('Type-3 clone: small additions tolerated', () => {
    const src1 =
      'def foo(items):\n    out = []\n    for x in items:\n        if x > 0:\n            out.append(x * 2)\n    return out\n';
    const src2 =
      'def foo(items):\n    out = []\n    for x in items:\n        if x > 0:\n            out.append(x * 2)\n            print(x)\n    return out\n';
    const a = tokenizePython('/a.py', src1);
    const b = tokenizePython('/b.py', src2);
    const families = findAllClones([a, b], { minTokens: 10 });
    expect(families.length).toBeGreaterThan(0);
  });

  it('comment-stripped: identical code with different comments still clones', () => {
    const src1 = 'def foo(x):\n    # first comment\n    return x + 1\n';
    const src2 = 'def foo(x):\n    # different comment\n    return x + 1\n';
    const a = tokenizePython('/a.py', src1);
    const b = tokenizePython('/b.py', src2);
    // Tokens should be identical because comments are stripped.
    expect(JSON.stringify(a.tokens.map((t) => [t.kind, t.value]))).toBe(
      JSON.stringify(b.tokens.map((t) => [t.kind, t.value])),
    );
  });

  it('docstring-stripped: identical code with different docstrings still clones', () => {
    const src1 = `def foo(x):\n    """one"""\n    return x + 1\n`;
    const src2 = `def foo(x):\n    """another"""\n    return x + 1\n`;
    const a = tokenizePython('/a.py', src1);
    const b = tokenizePython('/b.py', src2);
    expect(JSON.stringify(a.tokens.map((t) => [t.kind, t.value]))).toBe(
      JSON.stringify(b.tokens.map((t) => [t.kind, t.value])),
    );
  });

  it('mixed Python + TS in same project: each stream tokenizes independently', () => {
    const pySrc = 'def foo(x):\n    return x + 1\n';
    const tsSrc = 'function foo(x) { return x + 1 }';
    const a = tokenizePython('/a.py', pySrc);
    const b = tokenize('/b.ts', tsSrc);
    // Both produce non-empty token streams.
    expect(a.tokens.length).toBeGreaterThan(0);
    expect(b.tokens.length).toBeGreaterThan(0);
    // Find clones across the two — likely none (different keywords) but
    // findAllClones must NOT crash on mixed streams.
    const families = findAllClones([a, b], { minTokens: 5 });
    // Just exercising the mixed dispatch path.
    expect(Array.isArray(families)).toBe(true);
  });
});
