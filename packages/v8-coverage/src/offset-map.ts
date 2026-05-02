/**
 * offset-map.ts — Phase 3e (T110-T111) — byte-offset → line/col mapper.
 *
 * V8 coverage emits byte offsets relative to the script's source. Istanbul
 * consumers need 1-indexed line + 0-indexed column-by-codepoint. This module
 * builds a line-start byte-offset table once and provides O(log n) lookup.
 *
 * Behavior:
 *   - LF, CRLF, and lone CR all count as ONE line break. CRLF is detected as
 *     a unit (the next-line byte is `i + 2`); lone CR (Mac classic) advances
 *     by 1.
 *   - A leading 3-byte UTF-8 BOM (`0xEF 0xBB 0xBF`) is skipped from the byte
 *     count, but the first line still starts at byte 0 conceptually so column
 *     positions before the BOM are still meaningful.
 *   - Column = codepoint index within the line (NOT byte index, NOT UTF-16
 *     code unit index). UTF-8 leading-byte detection is used to count
 *     codepoints in O(byteOffset - lineStart) per lookup.
 *   - Out-of-range byteOffset (negative) clamps to {line: 1, col: 0};
 *     past-end clamps to last line + remaining codepoints.
 */

export interface Position {
  readonly line: number;
  readonly col: number;
}

export interface OffsetMap {
  readonly toPosition: (byteOffset: number) => Position;
  readonly lineCount: number;
}

const BOM0 = 0xef;
const BOM1 = 0xbb;
const BOM2 = 0xbf;
const LF = 0x0a;
const CR = 0x0d;

function binarySearchFloor(arr: readonly number[], target: number): number {
  // Returns the largest index i such that arr[i] <= target. Assumes arr non-empty
  // and arr[0] === 0 (which we always push at construction).
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    const v = arr[mid] ?? 0;
    if (v <= target) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/**
 * Count UTF-8 codepoints in `bytes[from..to]` by skipping continuation bytes
 * (`0b10xxxxxx`, range 0x80-0xBF). Leading bytes (ASCII or 0xC0-0xFD) each
 * begin a codepoint.
 */
function codepointCount(bytes: Uint8Array, from: number, to: number): number {
  let count = 0;
  for (let i = from; i < to; i++) {
    const b = bytes[i] ?? 0;
    // Continuation byte: 10xxxxxx
    if ((b & 0xc0) !== 0x80) {
      count++;
    }
  }
  return count;
}

export function buildOffsetMap(source: string): OffsetMap {
  const bytes = new TextEncoder().encode(source);
  const lineStarts: number[] = [0];

  // Skip a leading 3-byte UTF-8 BOM; the first line still starts at byte 0.
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === BOM0 && bytes[1] === BOM1 && bytes[2] === BOM2) {
    i = 3;
  }

  while (i < bytes.length) {
    const b = bytes[i];
    if (b === LF) {
      lineStarts.push(i + 1);
      i++;
    } else if (b === CR) {
      // CRLF counts as one break — point at byte after \n.
      const next = bytes[i + 1] === LF ? i + 2 : i + 1;
      lineStarts.push(next);
      i = next;
    } else {
      i++;
    }
  }

  const byteLength = bytes.length;

  function toPosition(byteOffset: number): Position {
    if (!Number.isFinite(byteOffset) || byteOffset < 0) {
      return { line: 1, col: 0 };
    }
    const clamped = byteOffset > byteLength ? byteLength : Math.floor(byteOffset);
    const lineIdx = binarySearchFloor(lineStarts, clamped);
    const lineStart = lineStarts[lineIdx] ?? 0;
    const col = codepointCount(bytes, lineStart, clamped);
    return { line: lineIdx + 1, col };
  }

  return {
    toPosition,
    lineCount: lineStarts.length,
  };
}
