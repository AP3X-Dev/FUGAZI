/**
 * offset-map.test.ts — Phase 3e (T111) — codepoint-aware byte-offset mapper.
 *
 * Eight fixtures: ASCII, multi-byte UTF-8, CRLF, mixed line endings, BOM,
 * Vitest column-null normalization (handled at integration), last line
 * without trailing newline, defensive out-of-range lookups.
 */

import { describe, expect, it } from 'vitest';
import { buildOffsetMap } from '../offset-map.js';

describe('offset-map — ASCII file', () => {
  it('positions at start, middle, and end', () => {
    const m = buildOffsetMap('a\nbb\nccc');
    expect(m.toPosition(0)).toEqual({ line: 1, col: 0 });
    expect(m.toPosition(2)).toEqual({ line: 2, col: 0 });
    expect(m.toPosition(3)).toEqual({ line: 2, col: 1 });
    expect(m.toPosition(5)).toEqual({ line: 3, col: 0 });
    expect(m.toPosition(7)).toEqual({ line: 3, col: 2 });
  });
});

describe('offset-map — emoji (4-byte UTF-8)', () => {
  it('column counts codepoints not bytes', () => {
    // '🎉' is 4 UTF-8 bytes (F0 9F 8E 89). 'a🎉b' encoded: a=1, 🎉=4, b=1.
    const m = buildOffsetMap('a🎉b');
    // After 'a' (byte 1): col = 1 codepoint
    expect(m.toPosition(1)).toEqual({ line: 1, col: 1 });
    // After '🎉' (byte 5): col = 2 codepoints
    expect(m.toPosition(5)).toEqual({ line: 1, col: 2 });
    // After 'b' (byte 6): col = 3 codepoints
    expect(m.toPosition(6)).toEqual({ line: 1, col: 3 });
  });

  it('résumé positions count codepoints', () => {
    // 'r' (1) 'é' (2) 's' (1) 'u' (1) 'm' (1) 'é' (2) — 8 bytes, 6 codepoints.
    const m = buildOffsetMap('résumé');
    expect(m.toPosition(8)).toEqual({ line: 1, col: 6 });
  });
});

describe('offset-map — CRLF line endings', () => {
  it('CRLF counted as one line break', () => {
    const m = buildOffsetMap('a\r\nbb\r\nccc');
    // After 'a\r\n' (3 bytes), next line starts at byte 3.
    expect(m.toPosition(3)).toEqual({ line: 2, col: 0 });
    // After 'bb\r\n' (4 more bytes → byte 7), line 3 starts at byte 7.
    expect(m.toPosition(7)).toEqual({ line: 3, col: 0 });
  });
});

describe('offset-map — mixed CRLF/LF/CR endings', () => {
  it('handles all three line-break flavors', () => {
    // 'a\nb\r\nc\rd' — LF then CRLF then lone CR. Line starts: 0, 2, 5, 7.
    const m = buildOffsetMap('a\nb\r\nc\rd');
    expect(m.toPosition(0)).toEqual({ line: 1, col: 0 });
    expect(m.toPosition(2)).toEqual({ line: 2, col: 0 });
    expect(m.toPosition(5)).toEqual({ line: 3, col: 0 });
    expect(m.toPosition(7)).toEqual({ line: 4, col: 0 });
    expect(m.lineCount).toBe(4);
  });
});

describe('offset-map — leading UTF-8 BOM', () => {
  it('skips the 3-byte BOM but first line still byte 0', () => {
    const bom = '﻿';
    const m = buildOffsetMap(`${bom}a\nb`);
    // BOM (3 bytes) + 'a' (byte 3) — still line 1.
    expect(m.toPosition(3)).toEqual({ line: 1, col: 1 });
    // After '\n' (byte 5).
    expect(m.toPosition(5)).toEqual({ line: 2, col: 0 });
  });
});

describe('offset-map — Vitest column: null mapping (defensive 0)', () => {
  it('byte offset 0 yields col 0 (mirrors null normalization)', () => {
    const m = buildOffsetMap('foo\nbar');
    expect(m.toPosition(0)).toEqual({ line: 1, col: 0 });
  });
});

describe('offset-map — last line without trailing newline', () => {
  it('clamps positions inside last line correctly', () => {
    const m = buildOffsetMap('abc\ndef');
    expect(m.toPosition(7)).toEqual({ line: 2, col: 3 });
    // lineCount should be 2 (no trailing newline → no extra line).
    expect(m.lineCount).toBe(2);
  });
});

describe('offset-map — out-of-range byteOffsets', () => {
  it('negative offsets clamp to {line:1, col:0}', () => {
    const m = buildOffsetMap('abc');
    expect(m.toPosition(-1)).toEqual({ line: 1, col: 0 });
    expect(m.toPosition(-100)).toEqual({ line: 1, col: 0 });
  });

  it('offsets past end clamp to last line + remaining codepoints', () => {
    const m = buildOffsetMap('abc');
    expect(m.toPosition(100)).toEqual({ line: 1, col: 3 });
  });

  it('NaN and Infinity treated defensively', () => {
    const m = buildOffsetMap('abc');
    expect(m.toPosition(Number.NaN)).toEqual({ line: 1, col: 0 });
    expect(m.toPosition(Number.POSITIVE_INFINITY)).toEqual({ line: 1, col: 0 });
  });
});
