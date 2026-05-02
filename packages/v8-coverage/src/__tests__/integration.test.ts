/**
 * integration.test.ts — Phase 3e (T118 integration) — end-to-end golden fixtures.
 *
 * Two scenarios: a Node `--experimental-test-coverage` style dump and a Vitest
 * `coverage-v8` style dump. Both are inlined to keep the test self-contained
 * (no binary fixtures shipped). For each, we assert key properties of the
 * normalized Istanbul output rather than a full golden JSON, because the
 * exact line/col offsets depend on the inline source string and would be
 * fragile across editor changes.
 */

import { describe, expect, it } from 'vitest';
import { normalizeToIstanbul } from '../istanbul.js';
import { parseCoverage } from '../parse.js';
import { rebaseCoverage } from '../rebase.js';
import { disambiguateScripts } from '../script-id.js';

describe('integration — Node --experimental-test-coverage shape', () => {
  it('parses, dedups, normalizes a small worker dump', () => {
    const source =
      'export function add(a, b) {\n  return a + b;\n}\nexport function sub(a, b) {\n  return a - b;\n}\n';
    const dump = JSON.stringify({
      result: [
        {
          scriptId: '12',
          url: 'file:///app/src/math.js',
          functions: [
            {
              functionName: 'add',
              ranges: [{ startOffset: 0, endOffset: 47, count: 4 }],
              isBlockCoverage: false,
            },
            {
              functionName: 'sub',
              ranges: [{ startOffset: 48, endOffset: source.length, count: 0 }],
              isBlockCoverage: false,
            },
          ],
        },
      ],
      'source-map-cache': {},
    });
    const parsed = parseCoverage(dump);
    expect(parsed.result).toHaveLength(1);
    const rebased = rebaseCoverage(parsed.result, {
      fromPrefix: 'file:///app',
      toPrefix: 'file:///Users/me/project',
    });
    expect(rebased[0]?.url).toBe('file:///Users/me/project/src/math.js');
    expect(rebased[0]?.unmapped).toBeUndefined();
    const dedup = disambiguateScripts({ result: rebased });
    const first = dedup[0];
    if (first === undefined) {
      expect.fail('expected at least one deduped script');
      return;
    }
    const istanbul = normalizeToIstanbul(first, source);
    expect(istanbul.path).toBe('file:///Users/me/project/src/math.js');
    expect(Object.keys(istanbul.fnMap)).toEqual(['0', '1']);
    expect(istanbul.fnMap['0']?.name).toBe('add');
    expect(istanbul.fnMap['1']?.name).toBe('sub');
    expect(istanbul.f['0']).toBe(4);
    expect(istanbul.f['1']).toBe(0);
    // Determinism: re-running gives byte-equal JSON.
    const a = JSON.stringify(istanbul);
    const b = JSON.stringify(normalizeToIstanbul(first, source));
    expect(a).toBe(b);
  });
});

describe('integration — Vitest coverage-v8 shape with block coverage', () => {
  it('handles isBlockCoverage:true with inner ranges', () => {
    const source = 'function pick(x) {\n  if (x) {\n    return 1;\n  }\n  return 0;\n}\n';
    const dump = JSON.stringify({
      result: [
        {
          scriptId: '1',
          url: 'file:///workspace/src/pick.js',
          functions: [
            {
              functionName: 'pick',
              ranges: [
                { startOffset: 0, endOffset: source.length, count: 2 },
                { startOffset: 28, endOffset: 47, count: 1 },
                { startOffset: 47, endOffset: 60, count: 1 },
              ],
              isBlockCoverage: true,
            },
          ],
        },
      ],
      'source-map-cache': null,
      timestamp: 1700000000,
    });
    const parsed = parseCoverage(dump);
    expect(parsed.timestamp).toBe(1700000000);
    const dedup = disambiguateScripts(parsed);
    const first = dedup[0];
    if (first === undefined) {
      expect.fail('expected at least one deduped script');
      return;
    }
    const istanbul = normalizeToIstanbul(first, source);
    expect(istanbul.fnMap['0']?.name).toBe('pick');
    expect(istanbul.f['0']).toBe(2);
    // Two inner block ranges → branchMap[0] with two locations.
    expect(istanbul.branchMap['0']?.locations).toHaveLength(2);
    expect(istanbul.b['0']).toEqual([1, 1]);
    // Statements emitted from the inner blocks.
    expect(Object.keys(istanbul.s)).toEqual(['0', '1']);
  });
});
