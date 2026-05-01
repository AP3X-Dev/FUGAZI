import { describe, expect, it } from 'vitest';
import {
  comparePositions,
  mergeRanges,
  rangeContains,
  tolerantPosition,
} from '../position-helpers.js';
import type { Position, Range } from '../position.js';

const pos = (line: number, column: number, byteOffset: number): Position => ({
  line,
  column,
  byteOffset,
});

const range = (start: Position, end: Position): Range => ({ start, end });

describe('comparePositions', () => {
  it('orders by line first', () => {
    expect(comparePositions(pos(1, 0, 0), pos(2, 0, 0))).toBeLessThan(0);
    expect(comparePositions(pos(5, 0, 0), pos(2, 0, 0))).toBeGreaterThan(0);
  });

  it('breaks line ties by column', () => {
    expect(comparePositions(pos(3, 1, 0), pos(3, 5, 0))).toBeLessThan(0);
    expect(comparePositions(pos(3, 9, 0), pos(3, 5, 0))).toBeGreaterThan(0);
  });

  it('breaks line+column ties by byteOffset', () => {
    expect(comparePositions(pos(3, 4, 10), pos(3, 4, 20))).toBeLessThan(0);
    expect(comparePositions(pos(3, 4, 30), pos(3, 4, 20))).toBeGreaterThan(0);
  });

  it('returns 0 for identical positions', () => {
    expect(comparePositions(pos(1, 0, 0), pos(1, 0, 0))).toBe(0);
  });

  it('does not mutate either input', () => {
    const a = pos(1, 0, 0);
    const b = pos(2, 0, 0);
    const aSnap = { ...a };
    const bSnap = { ...b };
    comparePositions(a, b);
    expect(a).toEqual(aSnap);
    expect(b).toEqual(bSnap);
  });
});

describe('rangeContains', () => {
  const outer = range(pos(1, 0, 0), pos(10, 0, 200));
  const inner = range(pos(2, 0, 20), pos(5, 0, 100));

  it('returns true when inner equals outer', () => {
    expect(rangeContains(outer, outer)).toBe(true);
  });

  it('returns true when inner is strictly inside outer', () => {
    expect(rangeContains(outer, inner)).toBe(true);
  });

  it('returns false when inner extends past outer.end', () => {
    const beyond = range(pos(2, 0, 20), pos(11, 0, 250));
    expect(rangeContains(outer, beyond)).toBe(false);
  });

  it('returns false when inner starts before outer.start', () => {
    const before = range(pos(0, 0, 0), pos(5, 0, 100));
    expect(rangeContains(outer, before)).toBe(false);
  });

  it('returns false on partial overlap', () => {
    const overlap = range(pos(8, 0, 150), pos(15, 0, 300));
    expect(rangeContains(outer, overlap)).toBe(false);
  });

  it('returns false on a fully disjoint inner range', () => {
    const disjoint = range(pos(20, 0, 400), pos(25, 0, 500));
    expect(rangeContains(outer, disjoint)).toBe(false);
  });

  it('does not mutate either argument', () => {
    const o = range(pos(1, 0, 0), pos(10, 0, 200));
    const i = range(pos(2, 0, 20), pos(5, 0, 100));
    const oSnap = JSON.parse(JSON.stringify(o)) as Range;
    const iSnap = JSON.parse(JSON.stringify(i)) as Range;
    rangeContains(o, i);
    expect(o).toEqual(oSnap);
    expect(i).toEqual(iSnap);
  });
});

describe('mergeRanges', () => {
  it('returns the smallest covering range', () => {
    const a = range(pos(1, 0, 0), pos(3, 0, 30));
    const b = range(pos(2, 0, 20), pos(5, 0, 50));
    const merged = mergeRanges(a, b);
    expect(merged.start).toEqual(pos(1, 0, 0));
    expect(merged.end).toEqual(pos(5, 0, 50));
  });

  it('is commutative', () => {
    const a = range(pos(1, 0, 0), pos(3, 0, 30));
    const b = range(pos(2, 0, 20), pos(5, 0, 50));
    expect(mergeRanges(a, b)).toEqual(mergeRanges(b, a));
  });

  it('handles disjoint ranges by spanning the gap', () => {
    const a = range(pos(1, 0, 0), pos(2, 0, 20));
    const b = range(pos(5, 0, 50), pos(6, 0, 70));
    const merged = mergeRanges(a, b);
    expect(merged.start).toEqual(pos(1, 0, 0));
    expect(merged.end).toEqual(pos(6, 0, 70));
  });

  it('returns a range equal to either operand when one contains the other', () => {
    const big = range(pos(1, 0, 0), pos(10, 0, 200));
    const small = range(pos(3, 0, 30), pos(5, 0, 50));
    expect(mergeRanges(big, small)).toEqual(big);
  });

  it('returns the input range when both are identical', () => {
    const r = range(pos(2, 5, 25), pos(4, 7, 47));
    expect(mergeRanges(r, r)).toEqual(r);
  });

  it('does not mutate inputs', () => {
    const a = range(pos(1, 0, 0), pos(3, 0, 30));
    const b = range(pos(2, 0, 20), pos(5, 0, 50));
    const aSnap = JSON.parse(JSON.stringify(a)) as Range;
    const bSnap = JSON.parse(JSON.stringify(b)) as Range;
    mergeRanges(a, b);
    expect(a).toEqual(aSnap);
    expect(b).toEqual(bSnap);
  });
});

describe('tolerantPosition (FR-H5)', () => {
  it('maps Vitest column: null to column: 0', () => {
    expect(tolerantPosition({ line: 5, column: null })).toEqual({
      line: 5,
      column: 0,
      byteOffset: 0,
    });
  });

  it('maps column: undefined to column: 0', () => {
    expect(tolerantPosition({ line: 5, column: undefined })).toEqual({
      line: 5,
      column: 0,
      byteOffset: 0,
    });
  });

  it('preserves a numeric column verbatim', () => {
    expect(tolerantPosition({ line: 5, column: 7, byteOffset: 100 })).toEqual({
      line: 5,
      column: 7,
      byteOffset: 100,
    });
  });

  it('defaults byteOffset to 0 when omitted', () => {
    expect(tolerantPosition({ line: 1, column: 3 })).toEqual({
      line: 1,
      column: 3,
      byteOffset: 0,
    });
  });

  it('preserves byteOffset of 0 when explicitly provided', () => {
    expect(tolerantPosition({ line: 1, column: 3, byteOffset: 0 })).toEqual({
      line: 1,
      column: 3,
      byteOffset: 0,
    });
  });

  it('does not mutate input', () => {
    const input = { line: 5, column: null as number | null, byteOffset: 42 };
    const snap = { ...input };
    tolerantPosition(input);
    expect(input).toEqual(snap);
  });

  it('returned Position is structurally typed and assignable', () => {
    const p: Position = tolerantPosition({ line: 2, column: 4 });
    expect(p.line).toBe(2);
    expect(p.column).toBe(4);
    expect(p.byteOffset).toBe(0);
  });
});
