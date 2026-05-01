import type { Position, Range } from './position.js';

/**
 * Position / Range helpers — pure, side-effect-free utilities for ordering,
 * containment, merging, and tolerant Position construction. Per NFR-1
 * (determinism) all helpers return new objects; no input is mutated.
 */

/**
 * Total ordering on `Position` values: line first, then column, then
 * byteOffset. Returns a negative number if `a < b`, 0 if equal, positive if
 * `a > b`.
 *
 * Suitable for `Array.prototype.sort` callbacks; the byteOffset tiebreaker
 * keeps emission stable when the parser reports two positions at the same
 * line/column (rare but possible at synthetic locations).
 */
export function comparePositions(a: Position, b: Position): number {
  if (a.line !== b.line) return a.line - b.line;
  if (a.column !== b.column) return a.column - b.column;
  return a.byteOffset - b.byteOffset;
}

/**
 * Returns true iff `outer` fully contains `inner` (inclusive on both ends).
 *
 * Equality of either start or end is permitted: a range contains itself.
 * Partial overlap returns false.
 */
export function rangeContains(outer: Range, inner: Range): boolean {
  return (
    comparePositions(outer.start, inner.start) <= 0 && comparePositions(inner.end, outer.end) <= 0
  );
}

/**
 * Returns the smallest `Range` that covers both `a` and `b`. Commutative.
 *
 * If the two ranges are disjoint, the result spans the gap; this matches the
 * convex-hull semantics expected by reporters that surface a single
 * combined location for multi-site findings.
 */
export function mergeRanges(a: Range, b: Range): Range {
  const start = comparePositions(a.start, b.start) <= 0 ? a.start : b.start;
  const end = comparePositions(a.end, b.end) >= 0 ? a.end : b.end;
  return { start, end };
}

/**
 * Constructs a fully-typed `Position` from input that may carry the Vitest
 * convention of `column: null`. Per FR-H5, a null or missing column is
 * mapped to 0; missing byteOffset defaults to 0 as well.
 *
 * The function is pure and tolerant: it accepts any input shape conforming
 * to the parameter type, and produces a `Position` suitable for downstream
 * range / sort / containment operations.
 */
export function tolerantPosition(input: {
  readonly line: number;
  readonly column: number | null | undefined;
  readonly byteOffset?: number;
}): Position {
  return {
    line: input.line,
    column: input.column ?? 0,
    byteOffset: input.byteOffset ?? 0,
  };
}
