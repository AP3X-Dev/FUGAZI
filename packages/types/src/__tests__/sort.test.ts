import { fc, test as fctest } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';
import { type FileId, assignFileIds } from '../file-id.js';
import { byFileId, byPath, byPathThenLine } from '../sort.js';

describe('byPath', () => {
  it('returns a copy sorted lexicographically by path', () => {
    const input = [
      { path: 'b.ts', n: 2 },
      { path: 'a.ts', n: 1 },
      { path: 'c.ts', n: 3 },
    ] as const;
    const out = byPath(input);
    expect(out.map((x) => x.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('does not mutate the input array (returns a new array)', () => {
    const input = [{ path: 'b.ts' }, { path: 'a.ts' }, { path: 'c.ts' }];
    const snapshot = input.map((x) => ({ ...x }));
    const out = byPath(input);
    expect(input).toEqual(snapshot);
    expect(Object.is(input, out)).toBe(false);
  });

  it('uses bare lexicographic comparator (not localeCompare)', () => {
    // 'Z' (0x5A) sorts before 'a' (0x61) in lexicographic byte order.
    const out = byPath([{ path: 'a' }, { path: 'Z' }]);
    expect(out.map((x) => x.path)).toEqual(['Z', 'a']);
  });

  it('returns equal-length output', () => {
    const input = [{ path: 'b' }, { path: 'a' }];
    expect(byPath(input).length).toBe(input.length);
  });
});

describe('byFileId', () => {
  it('sorts by numeric FileId ascending', () => {
    const map = assignFileIds(['c.ts', 'a.ts', 'b.ts']);
    const a = map.get('a.ts') as FileId;
    const b = map.get('b.ts') as FileId;
    const c = map.get('c.ts') as FileId;
    const input = [
      { fileId: c, label: 'c' },
      { fileId: a, label: 'a' },
      { fileId: b, label: 'b' },
    ];
    const out = byFileId(input);
    expect(out.map((x) => x.label)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const map = assignFileIds(['x', 'y', 'z']);
    const ids = [...map.values()].reverse();
    const input = ids.map((fileId) => ({ fileId }));
    const snapshot = input.map((x) => ({ ...x }));
    const out = byFileId(input);
    expect(input).toEqual(snapshot);
    expect(Object.is(input, out)).toBe(false);
  });
});

describe('byPathThenLine', () => {
  it('sorts by path first, then line number', () => {
    const input = [
      { path: 'b.ts', line: 1 },
      { path: 'a.ts', line: 10 },
      { path: 'a.ts', line: 2 },
      { path: 'b.ts', line: 5 },
    ];
    const out = byPathThenLine(input);
    expect(out).toEqual([
      { path: 'a.ts', line: 2 },
      { path: 'a.ts', line: 10 },
      { path: 'b.ts', line: 1 },
      { path: 'b.ts', line: 5 },
    ]);
  });

  it('does not mutate the input array', () => {
    const input = [
      { path: 'b', line: 2 },
      { path: 'a', line: 1 },
    ];
    const snapshot = input.map((x) => ({ ...x }));
    const out = byPathThenLine(input);
    expect(input).toEqual(snapshot);
    expect(Object.is(input, out)).toBe(false);
  });

  it('preserves a single path group sorted only by line', () => {
    const input = [
      { path: 'a', line: 30 },
      { path: 'a', line: 10 },
      { path: 'a', line: 20 },
    ];
    const out = byPathThenLine(input);
    expect(out.map((x) => x.line)).toEqual([10, 20, 30]);
  });
});

describe('idempotence — property test (100 samples)', () => {
  fctest.prop(
    [
      fc.array(
        fc.record({
          path: fc.string({ minLength: 0, maxLength: 20 }),
        }),
        { minLength: 0, maxLength: 50 },
      ),
    ],
    { numRuns: 100 },
  )('byPath(byPath(x)) deeply equals byPath(x)', (items) => {
    const once = byPath(items);
    const twice = byPath(once);
    expect(twice).toEqual(once);
    // distinct array identities (pure copy semantics)
    expect(Object.is(once, twice)).toBe(false);
  });

  fctest.prop(
    [
      fc.array(
        fc.record({
          path: fc.string({ minLength: 0, maxLength: 10 }),
          line: fc.integer({ min: 1, max: 1_000_000 }),
        }),
        { minLength: 0, maxLength: 30 },
      ),
    ],
    { numRuns: 100 },
  )('byPathThenLine is idempotent', (items) => {
    const once = byPathThenLine(items);
    const twice = byPathThenLine(once);
    expect(twice).toEqual(once);
  });
});
