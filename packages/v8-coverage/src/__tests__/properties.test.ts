/**
 * properties.test.ts — Phase 3e (T118) — fast-check property invariants.
 *
 * 10 properties covering the v8-coverage pipeline. The structured arbitrary
 * `arbCoverage` produces well-formed CoverageInput shapes from a small alphabet.
 * Random JSON would degrade the round-trip property to "the parser fails on
 * garbage" — same lesson the visitor / re-export property tests learned.
 *
 * Per-property `numRuns: 200` matches design-doc §7 cadence.
 */

import { fc, test as fctest } from '@fast-check/vitest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { normalizeToIstanbul } from '../istanbul.js';
import { buildOffsetMap } from '../offset-map.js';
import { parseCoverage } from '../parse.js';
import { rebaseCoverage } from '../rebase.js';
import { disambiguateScripts } from '../script-id.js';
import type { CoverageInput, FunctionCoverage, ScriptCoverage } from '../types.js';

// ----- arbitraries ---------------------------------------------------------

const arbName = fc.constantFrom('foo', 'bar', 'baz', 'quux', '');

const arbRange = fc
  .tuple(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), fc.nat({ max: 1000 }))
  .map(([a, c, count]) => {
    const start = Math.min(a, a + c);
    const end = Math.max(a + 1, a + c + 1);
    return { startOffset: start, endOffset: end, count };
  });

const arbFunction: fc.Arbitrary<FunctionCoverage> = fc.record({
  functionName: arbName,
  ranges: fc.array(arbRange, { minLength: 1, maxLength: 4 }),
  isBlockCoverage: fc.boolean(),
});

const arbScript: fc.Arbitrary<ScriptCoverage> = fc.record({
  scriptId: fc.integer({ min: 1, max: 100 }).map(String),
  url: fc.constantFrom('file:///a.js', 'file:///b.js', 'file:///c.js', ''),
  functions: fc.array(arbFunction, { minLength: 0, maxLength: 3 }),
});

const arbCoverage: fc.Arbitrary<CoverageInput> = fc.record({
  result: fc.array(arbScript, { minLength: 0, maxLength: 5 }),
});

// Silence the rebase-warning channel for the duration of the property suite —
// Property #5 deliberately exercises the "unmapped" path on every run.
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
  warnSpy.mockRestore();
});

const arbSource: fc.Arbitrary<string> = fc
  .array(fc.constantFrom('a', 'b', '\n', '\r\n', '\r', ' ', 'X', '🎉', 'é'), {
    minLength: 0,
    maxLength: 60,
  })
  .map((parts) => parts.join(''));

// ----- properties ----------------------------------------------------------

describe('Property #1: parse(stringify(c)) ≡ c on canonical schema', () => {
  fctest.prop({ c: arbCoverage }, { numRuns: 200 })('round-trip', ({ c }) => {
    const json = JSON.stringify(c);
    const parsed = parseCoverage(json);
    return JSON.stringify(parsed.result) === JSON.stringify(c.result);
  });
});

describe('Property #2: offset-map line monotonic in byteOffset', () => {
  fctest.prop({ src: arbSource }, { numRuns: 200 })('non-decreasing line', ({ src }) => {
    const m = buildOffsetMap(src);
    const bytes = new TextEncoder().encode(src).length;
    let prevLine = 0;
    for (let i = 0; i <= bytes; i += Math.max(1, Math.floor(bytes / 10) || 1)) {
      const line = m.toPosition(i).line;
      if (line < prevLine) return false;
      prevLine = line;
    }
    return true;
  });
});

describe('Property #3: script-id merge is associative', () => {
  fctest.prop({ a: arbScript, b: arbScript, c: arbScript }, { numRuns: 200 })(
    'merge((a,b),c) == merge(a,(b,c))',
    ({ a, b, c }) => {
      // Force same URL so the merge has work to do.
      const aa = { ...a, url: 'file:///shared.js' };
      const bb = { ...b, url: 'file:///shared.js' };
      const cc = { ...c, url: 'file:///shared.js' };
      const left = disambiguateScripts({
        result: [...disambiguateScripts({ result: [aa, bb] }), cc],
      });
      const right = disambiguateScripts({
        result: [aa, ...disambiguateScripts({ result: [bb, cc] })],
      });
      return JSON.stringify(left) === JSON.stringify(right);
    },
  );
});

describe('Property #4: script-id merge is commutative on counts/ranges', () => {
  // The kept `scriptId` and `isBlockCoverage` are intentionally first-seen and
  // therefore order-dependent. Range counts (the actual coverage signal) MUST
  // be commutative — order of dump entries cannot change the merged tally.
  fctest.prop({ a: arbScript, b: arbScript }, { numRuns: 200 })(
    'count totals stable across order',
    ({ a, b }) => {
      const aa = { ...a, url: 'file:///s.js' };
      const bb = { ...b, url: 'file:///s.js' };
      const ab = disambiguateScripts({ result: [aa, bb] });
      const ba = disambiguateScripts({ result: [bb, aa] });
      const tallies = (
        xs: readonly {
          functions: readonly {
            functionName: string;
            ranges: readonly { startOffset: number; endOffset: number; count: number }[];
          }[];
        }[],
      ): string => {
        const entries: Array<[string, number, number, number]> = [];
        for (const s of xs) {
          for (const fn of s.functions) {
            for (const r of fn.ranges) {
              entries.push([fn.functionName, r.startOffset, r.endOffset, r.count]);
            }
          }
        }
        entries.sort((x, y) => {
          for (let i = 0; i < 4; i++) {
            const xi = x[i] as string | number;
            const yi = y[i] as string | number;
            if (xi < yi) return -1;
            if (xi > yi) return 1;
          }
          return 0;
        });
        return JSON.stringify(entries);
      };
      return tallies(ab) === tallies(ba);
    },
  );
});

describe('Property #5: rebase identity when prefix not present', () => {
  fctest.prop({ s: arbScript }, { numRuns: 200 })('unmapped:true preserves URL', ({ s }) => {
    // Skip empty URLs which match any prefix trivially; we want a guaranteed mismatch.
    if (s.url.length === 0) return true;
    const out = rebaseCoverage([s], {
      fromPrefix: 'PREFIX_THAT_NEVER_MATCHES_ANYTHING',
      toPrefix: 'IRRELEVANT',
    });
    return out[0]?.url === s.url && out[0]?.unmapped === true;
  });
});

describe('Property #6: Istanbul output deterministic per input', () => {
  fctest.prop({ s: arbScript, src: arbSource }, { numRuns: 200 })(
    'normalize twice → byte-equal JSON',
    ({ s, src }) => {
      const a = JSON.stringify(normalizeToIstanbul(s, src));
      const b = JSON.stringify(normalizeToIstanbul(s, src));
      return a === b;
    },
  );
});

describe('Property #7: two runs over same coverage → byte-equal Istanbul JSON', () => {
  fctest.prop({ c: arbCoverage, src: arbSource }, { numRuns: 200 })(
    'pipeline determinism',
    ({ c, src }) => {
      const run = (): string => {
        const dedup = disambiguateScripts(c);
        const out = dedup.map((s) => normalizeToIstanbul(s, src));
        return JSON.stringify(out);
      };
      const a = run();
      const b = run();
      return a === b;
    },
  );
});

describe('Property #8: line/col bounded by source', () => {
  fctest.prop({ src: arbSource, off: fc.integer({ min: 0, max: 1000 }) }, { numRuns: 200 })(
    'line ≤ lineCount && col ≥ 0',
    ({ src, off }) => {
      const m = buildOffsetMap(src);
      const p = m.toPosition(off);
      return p.line >= 1 && p.line <= m.lineCount && p.col >= 0;
    },
  );
});

describe('Property #9: empty coverage → empty Istanbul (no exception)', () => {
  it('explicit empty input produces empty Istanbul shapes', () => {
    const out = normalizeToIstanbul({ scriptId: '1', url: 'file:///e.js', functions: [] }, '');
    expect(out.fnMap).toEqual({});
    expect(out.statementMap).toEqual({});
    expect(out.branchMap).toEqual({});
  });
});

describe('Property #10: malformed entries surface verbatim error string', () => {
  it('matches the prefix exactly', () => {
    try {
      parseCoverage('{}');
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).toMatch(/^v8-coverage: malformed input — /);
    }
  });
});
