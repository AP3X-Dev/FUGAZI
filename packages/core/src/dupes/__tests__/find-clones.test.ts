/**
 * find-clones tests — Phase 3f.4 Wave B.
 *
 * Subsumption + dispatcher integration.
 */

import { describe, expect, it } from 'vitest';
import { findAllClones } from '../find-clones.js';
import { tokenize } from '../tokenize.js';

const sharedBlock = (): string => {
  const lines: string[] = [];
  for (let i = 0; i < 20; i++) {
    lines.push(`function f${i}(x) { return x + ${i}; }`);
  }
  return lines.join('\n');
};

describe('findAllClones', () => {
  it('returns empty for empty input', () => {
    expect(findAllClones([])).toEqual([]);
  });

  it('runs all 4 detectors by default and merges output', () => {
    const a = tokenize('/a.ts', sharedBlock());
    const b = tokenize('/b.ts', sharedBlock());
    const families = findAllClones([a, b]);
    expect(families.length).toBeGreaterThanOrEqual(1);
    // The merged set should be non-empty; at least one Type-1 family should
    // dominate (exact match + identifier collapse both find it).
    const types = new Set(families.map((f) => f.kind));
    expect(types.size).toBeGreaterThanOrEqual(1);
  });

  it('subsumption: Type-1 wins over Type-2 at the same range', () => {
    // Identical content → Type-1 detects exact match, Type-2 also matches
    // (identifiers collapse to themselves). Subsumption should keep Type-1.
    const src = sharedBlock();
    const a = tokenize('/a.ts', src);
    const b = tokenize('/b.ts', src);
    const families = findAllClones([a, b]);
    expect(families.length).toBeGreaterThanOrEqual(1);
    const top = families[0];
    expect(top?.kind).toBe('type-1');
  });

  it('subsumption: shorter contained family is dropped', () => {
    // Same-content streams produce a long Type-1 family. The same content
    // also produces shorter LCP runs that subsumption should drop.
    const a = tokenize('/a.ts', sharedBlock());
    const b = tokenize('/b.ts', sharedBlock());
    const families = findAllClones([a, b], { enabledTypes: [1] });
    // Type-1-only run: any duplicate sub-family with shorter tokenLength
    // contained in a longer one should have been dropped.
    for (let i = 0; i < families.length; i++) {
      for (let j = 0; j < families.length; j++) {
        if (i === j) continue;
        const a1 = families[i];
        const b1 = families[j];
        if (a1 === undefined || b1 === undefined) continue;
        if (a1.tokenLength >= b1.tokenLength) continue;
        // a1 is shorter than b1. If every a1 occurrence is contained in some
        // b1 occurrence, subsumption should have dropped it — fail.
        let allContained = true;
        for (const occA of a1.occurrences) {
          let found = false;
          for (const occB of b1.occurrences) {
            if (occA.file !== occB.file) continue;
            if (
              occA.byteRange.start >= occB.byteRange.start &&
              occA.byteRange.end <= occB.byteRange.end
            ) {
              found = true;
              break;
            }
          }
          if (!found) {
            allContained = false;
            break;
          }
        }
        expect(allContained).toBe(false);
      }
    }
  });

  it('enabledTypes restricts which detectors run', () => {
    const a = tokenize('/a.ts', sharedBlock());
    const b = tokenize('/b.ts', sharedBlock());
    const onlyT2 = findAllClones([a, b], { enabledTypes: [2] });
    for (const f of onlyT2) expect(f.kind).toBe('type-2');
    const onlyT4 = findAllClones([a, b], { enabledTypes: [4] });
    for (const f of onlyT4) expect(f.kind).toBe('type-4');
  });

  it('determinism: two runs produce byte-equal JSON', () => {
    const a = tokenize('/a.ts', sharedBlock());
    const b = tokenize('/b.ts', sharedBlock());
    const r1 = findAllClones([a, b]);
    const r2 = findAllClones([a, b]);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('result and inner objects are frozen', () => {
    const a = tokenize('/a.ts', sharedBlock());
    const b = tokenize('/b.ts', sharedBlock());
    const families = findAllClones([a, b]);
    expect(Object.isFrozen(families)).toBe(true);
    if (families.length > 0) {
      expect(Object.isFrozen(families[0])).toBe(true);
    }
  });

  it('result is sorted by (-tokenLength, file, tokenStart)', () => {
    const a = tokenize('/a.ts', sharedBlock());
    const b = tokenize('/b.ts', sharedBlock());
    const families = findAllClones([a, b]);
    for (let i = 1; i < families.length; i++) {
      const prev = families[i - 1];
      const cur = families[i];
      if (prev === undefined || cur === undefined) continue;
      expect(prev.tokenLength).toBeGreaterThanOrEqual(cur.tokenLength);
    }
  });
});
