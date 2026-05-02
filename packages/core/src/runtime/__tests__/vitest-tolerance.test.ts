/**
 * vitest-tolerance.test.ts — Phase 3g Wave B acceptance suite for
 * `validateColumnTolerance`.
 *
 * The dedup state inside `warnOncePerFile` is process-wide and survives across
 * tests. We work around that by using unique file paths per test (`<test-id>`)
 * so no two cases collide on a dedup key.
 */

import { describe, expect, it, vi } from 'vitest';
import { validateColumnTolerance } from '../vitest-tolerance.js';

describe('validateColumnTolerance', () => {
  it('column: null triggers warn-once per file', () => {
    const onWarn = vi.fn<(f: string) => void>();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      validateColumnTolerance(
        {
          result: [
            {
              scriptId: '1',
              url: '/proj/vt-a.ts',
              functions: [
                {
                  functionName: 'f',
                  ranges: [{ startOffset: 0, endOffset: 5, count: 1, line: 1, column: null }],
                },
              ],
            },
          ],
        },
        { onWarn },
      );
      expect(onWarn).toHaveBeenCalledTimes(1);
      expect(onWarn).toHaveBeenCalledWith('/proj/vt-a.ts');
      // Verbatim message asserted via console.warn spy:
      expect(warn).toHaveBeenCalledWith(
        'runtime-coverage: column field missing or null in /proj/vt-a.ts; treating as column 0',
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('warn-once dedup keyed by file path — same file, repeated calls, single warn', () => {
    const onWarn = vi.fn<(f: string) => void>();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const input = {
        result: [
          {
            scriptId: '1',
            url: '/proj/vt-dup.ts',
            functions: [
              {
                functionName: 'f',
                ranges: [{ startOffset: 0, endOffset: 1, count: 0, column: null }],
              },
            ],
          },
        ],
      };
      validateColumnTolerance(input, { onWarn });
      validateColumnTolerance(input, { onWarn });
      validateColumnTolerance(input, { onWarn });
      expect(onWarn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('non-null column → no warn', () => {
    const onWarn = vi.fn<(f: string) => void>();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      validateColumnTolerance(
        {
          result: [
            {
              scriptId: '1',
              url: '/proj/vt-clean.ts',
              functions: [
                {
                  functionName: 'f',
                  ranges: [{ startOffset: 0, endOffset: 5, count: 1, column: 0 }],
                },
              ],
            },
          ],
        },
        { onWarn },
      );
      expect(onWarn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('multi-file: each file warned independently', () => {
    const onWarn = vi.fn<(f: string) => void>();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      validateColumnTolerance(
        {
          result: [
            {
              scriptId: '1',
              url: '/proj/vt-multi-a.ts',
              functions: [
                {
                  functionName: 'f',
                  ranges: [{ startOffset: 0, endOffset: 1, count: 0, column: null }],
                },
              ],
            },
            {
              scriptId: '2',
              url: '/proj/vt-multi-b.ts',
              functions: [
                {
                  functionName: 'g',
                  ranges: [{ startOffset: 0, endOffset: 1, count: 0, column: null }],
                },
              ],
            },
          ],
        },
        { onWarn },
      );
      expect(onWarn).toHaveBeenCalledTimes(2);
      expect(onWarn.mock.calls.map((c) => c[0])).toEqual([
        '/proj/vt-multi-a.ts',
        '/proj/vt-multi-b.ts',
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it('malformed input → silently skipped, no throw', () => {
    expect(() => validateColumnTolerance(null)).not.toThrow();
    expect(() => validateColumnTolerance({})).not.toThrow();
    expect(() => validateColumnTolerance({ result: 'not-array' })).not.toThrow();
    expect(() => validateColumnTolerance({ result: [{}] })).not.toThrow();
  });
});
