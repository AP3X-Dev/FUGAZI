import { fc, test as fctest } from '@fast-check/vitest';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { type FileId, ROOT_FILE_ID, assignFileIds, compareFileIds } from '../file-id.js';

describe('FileId branded type', () => {
  it('is a number at the value level', () => {
    expectTypeOf<FileId>().toMatchTypeOf<number>();
  });

  it('is NOT assignable from a plain number without a cast', () => {
    // @ts-expect-error — plain number cannot be assigned to FileId
    const _bad: FileId = 5;
    void _bad;
  });

  it('preserves identity through compareFileIds', () => {
    const map = assignFileIds(['a.ts']);
    const id = map.get('a.ts');
    expect(id).toBeDefined();
    if (id !== undefined) {
      expect(compareFileIds(id, id)).toBe(0);
    }
  });
});

describe('ROOT_FILE_ID', () => {
  it('is FileId 0 — the project root sentinel (ADR-004)', () => {
    expect(ROOT_FILE_ID as number).toBe(0);
  });

  it('does not collide with any assigned id', () => {
    const map = assignFileIds(['a.ts', 'b.ts', 'c.ts']);
    for (const id of map.values()) {
      expect(id as number).not.toBe(ROOT_FILE_ID as number);
      expect((id as number) >= 1).toBe(true);
    }
  });
});

describe('assignFileIds', () => {
  it('returns a ReadonlyMap keyed by path', () => {
    const map = assignFileIds(['b.ts', 'a.ts']);
    expectTypeOf(map).toMatchTypeOf<ReadonlyMap<string, FileId>>();
  });

  it('starts assignments at 1 (0 reserved for root)', () => {
    const map = assignFileIds(['only.ts']);
    expect(map.get('only.ts') as number).toBe(1);
  });

  it('assigns sorted, contiguous ids 1..n', () => {
    const map = assignFileIds(['c.ts', 'a.ts', 'b.ts']);
    expect(map.get('a.ts') as number).toBe(1);
    expect(map.get('b.ts') as number).toBe(2);
    expect(map.get('c.ts') as number).toBe(3);
  });

  it('iterates the returned Map in lexicographic (sorted) order — FR-D3', () => {
    const map = assignFileIds(['c.ts', 'a.ts', 'b.ts']);
    expect([...map.keys()]).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('produces identical mapping regardless of input order — SC-7', () => {
    const a = assignFileIds(['b', 'a', 'c']);
    const b = assignFileIds(['c', 'b', 'a']);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('handles an empty input', () => {
    const map = assignFileIds([]);
    expect(map.size).toBe(0);
  });

  it('handles a single-element input', () => {
    const map = assignFileIds(['only.ts']);
    expect(map.size).toBe(1);
    expect(map.get('only.ts') as number).toBe(1);
  });

  it('does not mutate the input array', () => {
    const input = ['c.ts', 'a.ts', 'b.ts'];
    const snapshot = [...input];
    assignFileIds(input);
    expect(input).toEqual(snapshot);
  });

  it('uses bare comparator (a < b ? -1 : a > b ? 1 : 0), not localeCompare', () => {
    // Verify lexicographic byte-order, not locale-dependent collation.
    // 'Z' (0x5A) sorts before 'a' (0x61) in lexicographic order, but locales
    // sometimes treat them case-insensitively. We assert the lexicographic
    // (deterministic, locale-independent) result.
    const map = assignFileIds(['a', 'Z']);
    expect(map.get('Z') as number).toBe(1);
    expect(map.get('a') as number).toBe(2);
  });
});

describe('compareFileIds', () => {
  it('returns negative when a < b', () => {
    const map = assignFileIds(['a.ts', 'b.ts']);
    const a = map.get('a.ts');
    const b = map.get('b.ts');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a !== undefined && b !== undefined) {
      expect(compareFileIds(a, b)).toBeLessThan(0);
    }
  });

  it('returns positive when a > b', () => {
    const map = assignFileIds(['a.ts', 'b.ts']);
    const a = map.get('a.ts');
    const b = map.get('b.ts');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a !== undefined && b !== undefined) {
      expect(compareFileIds(b, a)).toBeGreaterThan(0);
    }
  });

  it('returns 0 when ids are equal', () => {
    const map = assignFileIds(['a.ts']);
    const a = map.get('a.ts');
    expect(a).toBeDefined();
    if (a !== undefined) {
      expect(compareFileIds(a, a)).toBe(0);
    }
  });

  it('is suitable for Array.prototype.sort', () => {
    const map = assignFileIds(['b.ts', 'a.ts', 'c.ts']);
    const ids = [...map.values()];
    // assignFileIds already returns sorted iteration order; reverse and resort.
    const reversed = [...ids].reverse();
    const resorted = [...reversed].sort(compareFileIds);
    expect(resorted).toEqual(ids);
  });
});

describe('FileId stability under permutation — SC-7 property test', () => {
  fctest.prop([
    fc.uniqueArray(fc.string({ minLength: 1, maxLength: 50 }), {
      minLength: 1,
      maxLength: 50,
    }),
  ])('assignFileIds(perm(paths)) === assignFileIds(paths)', (paths) => {
    const original = assignFileIds(paths);
    // Math.random is acceptable in tests (forbidden only in hot paths);
    // the random shuffle here is intentional to exercise permutation invariance.
    const shuffled = [...paths].sort(() => 0.5 - Math.random());
    const fromShuffled = assignFileIds(shuffled);
    expect(fromShuffled.size).toBe(original.size);
    for (const [path, id] of original) {
      expect(fromShuffled.get(path)).toBe(id);
    }
  });
});
