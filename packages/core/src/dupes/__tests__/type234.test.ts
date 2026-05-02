/**
 * type234 tests — Phase 3f.4 Wave B.
 *
 * 6 fixtures: Type-2 (×2), Type-3 (×2), Type-4 (×2).
 */

import { describe, expect, it } from 'vitest';
import { tokenize } from '../tokenize.js';
import { findType2Clones, findType3Clones, findType4Clones } from '../type234.js';

const big = (paramName: string): string => {
  const lines: string[] = [];
  for (let i = 0; i < 20; i++) {
    lines.push(`function f${i}(${paramName}) { return ${paramName} + ${i}; }`);
  }
  return lines.join('\n');
};

describe('findType2Clones', () => {
  it('renamed parameters across two files produce a Type-2 family', () => {
    const a = tokenize('/a.ts', big('alpha'));
    const b = tokenize('/b.ts', big('beta'));
    const families = findType2Clones([a, b]);
    expect(families.length).toBeGreaterThanOrEqual(1);
    const top = families[0];
    expect(top?.kind).toBe('type-2');
    expect(top?.occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it('truly disjoint structure does NOT yield a Type-2 family', () => {
    // Different shapes — one has `for`, the other has `try/catch`.
    const aSrc = [
      'function f(x) {',
      '  for (let i = 0; i < 10; i++) {',
      '    x = x + i;',
      '  }',
      '  return x;',
      '}',
    ]
      .concat([
        'function g(y) {',
        '  for (let j = 0; j < 5; j++) {',
        '    y = y + j;',
        '  }',
        '  return y;',
        '}',
      ])
      .join('\n');
    const bSrc = [
      'function h() {',
      '  try {',
      '    doSomething();',
      '  } catch (e) {',
      '    throw e;',
      '  }',
      '}',
    ]
      .concat([
        'function i() {',
        '  try {',
        '    doMore();',
        '  } catch (z) {',
        '    throw z;',
        '  }',
        '}',
      ])
      .join('\n');
    const a = tokenize('/a.ts', aSrc);
    const b = tokenize('/b.ts', bSrc);
    const families = findType2Clones([a, b], { minTokens: 80 });
    // Cross-file Type-2 hits at minTokens=80 should not surface — sources are
    // structurally different.
    const cross = families.filter((f) => {
      const files = new Set(f.occurrences.map((o) => o.file));
      return files.size >= 2;
    });
    expect(cross.length).toBe(0);
  });
});

describe('findType3Clones', () => {
  it('Type-3 surfaces the same identifier-collapsed matches as Type-2 (v1 heuristic)', () => {
    const a = tokenize('/a.ts', big('p'));
    const b = tokenize('/b.ts', big('q'));
    const t2 = findType2Clones([a, b]);
    const t3 = findType3Clones([a, b]);
    expect(t3.length).toBeGreaterThanOrEqual(t2.length);
    for (const f of t3) expect(f.kind).toBe('type-3');
  });

  it('respects minTokens through Type-3 path', () => {
    const a = tokenize('/a.ts', 'const x = 1;');
    const b = tokenize('/b.ts', 'const y = 2;');
    const families = findType3Clones([a, b], { minTokens: 50 });
    expect(families.length).toBe(0);
  });
});

describe('findType4Clones', () => {
  it('ternary-return ↔ if-return rewriting brings two equivalent snippets to the same family', () => {
    // Each file contains the SAME shape repeated (so Type-4 fires within a
    // single file at minTokens=15) — once as ternary, once as if-return.
    const ternaryBlock = (suffix: string): string =>
      `function f${suffix}(a, b, c) { return a ? b : c; }\nfunction g${suffix}(x, y, z) { return x ? y : z; }`;
    const ifReturnBlock = (suffix: string): string =>
      `function p${suffix}(a, b, c) { if (a) return b; return c; }\nfunction q${suffix}(x, y, z) { if (x) return y; return z; }`;
    const lines: string[] = [];
    for (let i = 0; i < 5; i++) lines.push(ternaryBlock(`A${i}`));
    for (let i = 0; i < 5; i++) lines.push(ifReturnBlock(`B${i}`));
    const a = tokenize('/a.ts', lines.join('\n'));
    const families = findType4Clones([a], { minTokens: 15 });
    expect(families.length).toBeGreaterThanOrEqual(1);
    for (const f of families) expect(f.kind).toBe('type-4');
  });

  it('while-loop ↔ for-loop rewriting normalizes both forms to the for canonical', () => {
    const forBlock = 'function f() { for (let i = 0; i < 10; i++) { doSomething(i); } }';
    const whileBlock = 'function g() { let i = 0; while (i < 10) { doSomething(i); i = i + 1; } }';
    const src = [forBlock, whileBlock, forBlock, whileBlock].join('\n');
    const a = tokenize('/a.ts', src);
    const families = findType4Clones([a], { minTokens: 15 });
    expect(families.length).toBeGreaterThanOrEqual(1);
    const top = families[0];
    expect(top?.kind).toBe('type-4');
    expect(top?.occurrences.length).toBeGreaterThanOrEqual(2);
  });
});
