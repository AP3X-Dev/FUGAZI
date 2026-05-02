/**
 * parse.test.ts — Phase 3e (T109) — schema validation + format tolerance.
 *
 * 10 fixtures covering the documented Node + Vitest input variants and the
 * verbatim error strings (E5 / IMP-CORRECT-09) for malformed inputs.
 */

import { FugaziCoverageError } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import { parseCoverage } from '../parse.js';

describe('parseCoverage — Node format with full ranges', () => {
  it('accepts Node --experimental-test-coverage shape', () => {
    const json = JSON.stringify({
      result: [
        {
          scriptId: '42',
          url: 'file:///t/x.js',
          functions: [
            {
              functionName: 'foo',
              ranges: [{ startOffset: 0, endOffset: 10, count: 3 }],
              isBlockCoverage: false,
            },
          ],
        },
      ],
    });
    const out = parseCoverage(json);
    expect(out.result).toHaveLength(1);
    expect(out.result[0]?.functions[0]?.functionName).toBe('foo');
    expect(out.result[0]?.functions[0]?.isBlockCoverage).toBe(false);
  });
});

describe('parseCoverage — Vitest format with column: null tolerance', () => {
  it('does not reject extra/null fields on ranges', () => {
    const json = JSON.stringify({
      result: [
        {
          scriptId: '7',
          url: 'file:///t/v.js',
          functions: [
            {
              functionName: 'bar',
              ranges: [
                {
                  startOffset: 0,
                  endOffset: 5,
                  count: 1,
                  // Vitest sometimes includes line/column null on ranges.
                  line: 1,
                  column: null,
                },
              ],
              isBlockCoverage: true,
            },
          ],
        },
      ],
    });
    const out = parseCoverage(json);
    expect(out.result[0]?.functions[0]?.isBlockCoverage).toBe(true);
  });
});

describe('parseCoverage — Vitest coverage-v8 wrapper', () => {
  it('tolerates extra top-level keys', () => {
    const json = JSON.stringify({
      result: [{ scriptId: '1', url: 'file:///t/a.js', functions: [] }],
      'source-map-cache': { foo: 'bar' },
      timestamp: 12345,
    });
    const out = parseCoverage(json);
    expect(out.result).toHaveLength(1);
    expect(out.timestamp).toBe(12345);
    expect(out['source-map-cache']).toEqual({ foo: 'bar' });
  });
});

describe('parseCoverage — empty result', () => {
  it('accepts result: [] as valid empty input', () => {
    const json = JSON.stringify({ result: [] });
    const out = parseCoverage(json);
    expect(out.result).toEqual([]);
  });
});

describe('parseCoverage — missing result triggers verbatim error', () => {
  it("emits 'missing result array'", () => {
    const json = JSON.stringify({ data: [] });
    expect(() => parseCoverage(json)).toThrow(FugaziCoverageError);
    try {
      parseCoverage(json);
    } catch (e) {
      expect((e as Error).message).toBe("v8-coverage: malformed input — missing 'result' array");
    }
  });
});

describe('parseCoverage — missing scriptId on entry 0', () => {
  it('emits verbatim entry-indexed error', () => {
    const json = JSON.stringify({
      result: [{ url: 'file:///x.js', functions: [] }],
    });
    try {
      parseCoverage(json);
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).toBe(
        "v8-coverage: malformed input — entry 0 missing 'scriptId'",
      );
    }
  });
});

describe('parseCoverage — missing url on entry 1', () => {
  it('emits verbatim entry-indexed error', () => {
    const json = JSON.stringify({
      result: [
        { scriptId: '1', url: 'file:///a.js', functions: [] },
        { scriptId: '2', functions: [] },
      ],
    });
    try {
      parseCoverage(json);
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).toBe("v8-coverage: malformed input — entry 1 missing 'url'");
    }
  });
});

describe('parseCoverage — malformed function entry', () => {
  it('rejects a non-object function', () => {
    const json = JSON.stringify({
      result: [{ scriptId: '1', url: 'file:///a.js', functions: ['not an object'] }],
    });
    try {
      parseCoverage(json);
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).toBe(
        'v8-coverage: malformed input — entry 0 function 0 not an object',
      );
    }
  });

  it('rejects a function missing ranges', () => {
    const json = JSON.stringify({
      result: [
        {
          scriptId: '1',
          url: 'file:///a.js',
          functions: [{ functionName: 'x' }],
        },
      ],
    });
    try {
      parseCoverage(json);
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).toBe(
        "v8-coverage: malformed input — entry 0 function 0 missing 'ranges' array",
      );
    }
  });
});

describe('parseCoverage — minified single-line script with large byteOffsets', () => {
  it('preserves large numeric offsets verbatim', () => {
    const json = JSON.stringify({
      result: [
        {
          scriptId: '1',
          url: 'file:///dist/min.js',
          functions: [
            {
              functionName: '',
              ranges: [{ startOffset: 0, endOffset: 250000, count: 1 }],
              isBlockCoverage: true,
            },
          ],
        },
      ],
    });
    const out = parseCoverage(json);
    expect(out.result[0]?.functions[0]?.ranges[0]?.endOffset).toBe(250000);
  });
});

describe('parseCoverage — multi-byte UTF-8 in functionName', () => {
  it('preserves codepoints unchanged', () => {
    const json = JSON.stringify({
      result: [
        {
          scriptId: '1',
          url: 'file:///t/a.js',
          functions: [
            {
              functionName: 'résumé🎉',
              ranges: [{ startOffset: 0, endOffset: 3, count: 1 }],
              isBlockCoverage: false,
            },
          ],
        },
      ],
    });
    const out = parseCoverage(json);
    expect(out.result[0]?.functions[0]?.functionName).toBe('résumé🎉');
  });
});

describe('parseCoverage — invalid JSON syntax', () => {
  it('wraps JSON.parse errors with verbatim prefix', () => {
    try {
      parseCoverage('{bad json');
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).toMatch(/^v8-coverage: malformed input — JSON parse error: /);
    }
  });
});
