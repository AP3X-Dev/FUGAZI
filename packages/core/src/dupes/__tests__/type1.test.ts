/**
 * type1 detector tests — Phase 3f.4 Wave A.
 *
 * Validates: cross-file clones, single-file clones, sub-threshold
 * suppression, multi-occurrence families, and determinism.
 */

import { describe, expect, it } from 'vitest';
import { tokenize } from '../tokenize.js';
import { findType1Clones } from '../type1.js';

/**
 * `bigBlock(seed)` — produce a deterministic source block of ~80 tokens.
 * Each block uses the seed in identifiers so different seeds produce
 * different content.
 */
const bigBlock = (seed: string): string => {
  const lines: string[] = [];
  for (let i = 0; i < 20; i++) {
    lines.push(`const ${seed}${i} = ${i} + ${i + 1};`);
  }
  return lines.join('\n');
};

const sharedBlock = (): string => {
  const lines: string[] = [];
  for (let i = 0; i < 20; i++) {
    lines.push(`function f${i}(x) { return x + ${i}; }`);
  }
  return lines.join('\n');
};

describe('findType1Clones', () => {
  it('(a) two files with identical 50+ token block → 1 family, 2 occurrences', () => {
    const a = tokenize('/a.ts', sharedBlock());
    const b = tokenize('/b.ts', sharedBlock());
    const families = findType1Clones([a, b]);
    expect(families.length).toBeGreaterThanOrEqual(1);
    const top = families[0];
    expect(top).toBeDefined();
    expect(top?.kind).toBe('type-1');
    expect(top?.occurrences.length).toBeGreaterThanOrEqual(2);
    expect(top?.tokenLength).toBeGreaterThanOrEqual(50);
  });

  it('(b) clone shorter than minTokens → no families', () => {
    // 5 tokens of shared content — way under minTokens default of 50.
    const a = tokenize('/a.ts', 'const x = 1; let y = 2;');
    const b = tokenize('/b.ts', 'const x = 1; let z = 3;');
    const families = findType1Clones([a, b]);
    // Default minTokens=50, content is far too short.
    expect(families.length).toBe(0);
  });

  it('(b2) custom minTokens lets short clones through', () => {
    const a = tokenize('/a.ts', 'const x = 1; const y = 2;');
    const b = tokenize('/b.ts', 'const x = 1; const y = 2;');
    const families = findType1Clones([a, b], { minTokens: 5 });
    expect(families.length).toBeGreaterThanOrEqual(1);
  });

  it('(c) one block appearing 3+ times across files → 1 family, ≥3 occurrences', () => {
    const a = tokenize('/a.ts', sharedBlock());
    const b = tokenize('/b.ts', sharedBlock());
    const c = tokenize('/c.ts', sharedBlock());
    const families = findType1Clones([a, b, c]);
    expect(families.length).toBeGreaterThanOrEqual(1);
    const top = families[0];
    expect(top?.occurrences.length).toBeGreaterThanOrEqual(3);
    // Each occurrence is from a distinct file (no overlap dedupe firing).
    const filesSeen = new Set(top?.occurrences.map((o) => o.file));
    expect(filesSeen.size).toBeGreaterThanOrEqual(3);
  });

  it('(d) single-file duplicate → 1 family, 2 occurrences (both in same file)', () => {
    const src = `${sharedBlock()}\nconst SEPARATOR = 1;\n${sharedBlock()}`;
    const a = tokenize('/a.ts', src);
    const families = findType1Clones([a]);
    expect(families.length).toBeGreaterThanOrEqual(1);
    const top = families[0];
    expect(top?.occurrences.length).toBeGreaterThanOrEqual(2);
    // All occurrences should be in /a.ts.
    expect(top?.occurrences.every((o) => o.file === '/a.ts')).toBe(true);
    // The two occurrences should NOT overlap.
    if (top && top.occurrences.length >= 2) {
      const o1 = top.occurrences[0];
      const o2 = top.occurrences[1];
      if (o1 && o2) {
        expect(o2.tokenStart).toBeGreaterThanOrEqual(o1.tokenEnd);
      }
    }
  });

  it('(e) determinism: two runs produce identical output', () => {
    const a = tokenize('/a.ts', sharedBlock());
    const b = tokenize('/b.ts', sharedBlock());
    const r1 = findType1Clones([a, b]);
    const r2 = findType1Clones([a, b]);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('emits valid byte ranges that map back into source', () => {
    const src = sharedBlock();
    const a = tokenize('/a.ts', src);
    const b = tokenize('/b.ts', src);
    const families = findType1Clones([a, b]);
    const top = families[0];
    expect(top).toBeDefined();
    if (!top) return;
    for (const occ of top.occurrences) {
      expect(occ.byteRange.start).toBeGreaterThanOrEqual(0);
      expect(occ.byteRange.end).toBeGreaterThan(occ.byteRange.start);
      // Range bytes should be within the source string.
      expect(occ.byteRange.end).toBeLessThanOrEqual(src.length);
    }
  });

  it('returns a frozen array of frozen families', () => {
    const a = tokenize('/a.ts', sharedBlock());
    const b = tokenize('/b.ts', sharedBlock());
    const families = findType1Clones([a, b]);
    expect(Object.isFrozen(families)).toBe(true);
    if (families.length > 0) {
      const f = families[0];
      expect(f).toBeDefined();
      if (f) {
        expect(Object.isFrozen(f)).toBe(true);
        expect(Object.isFrozen(f.occurrences)).toBe(true);
      }
    }
  });

  it('disjoint files produce no families', () => {
    const a = tokenize('/a.ts', bigBlock('alpha'));
    const b = tokenize('/b.ts', bigBlock('beta'));
    const families = findType1Clones([a, b]);
    expect(families.length).toBe(0);
  });

  it('empty input returns empty array', () => {
    expect(findType1Clones([])).toEqual([]);
  });

  it('occurrences within a family sort by (file, tokenStart)', () => {
    const a = tokenize('/a.ts', sharedBlock());
    const b = tokenize('/b.ts', sharedBlock());
    const c = tokenize('/c.ts', sharedBlock());
    const families = findType1Clones([c, a, b]);
    const top = families[0];
    expect(top).toBeDefined();
    if (!top) return;
    for (let k = 1; k < top.occurrences.length; k++) {
      const prev = top.occurrences[k - 1];
      const cur = top.occurrences[k];
      if (!prev || !cur) continue;
      const ord =
        prev.file < cur.file || (prev.file === cur.file && prev.tokenStart <= cur.tokenStart);
      expect(ord).toBe(true);
    }
  });
});
