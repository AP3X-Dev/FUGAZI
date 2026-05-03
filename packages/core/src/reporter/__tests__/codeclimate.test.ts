/**
 * codeclimate.test.ts — Phase 3j — CodeclimateReporter byte-equal tests.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CodeclimateReporter } from '../codeclimate.js';
import { SAMPLE_EVENTS, SAMPLE_ISSUES, SAMPLE_META } from './fixtures/sample-issues.js';
import { runReporter, shuffle } from './helpers.js';

interface CcIssue {
  type: string;
  check_name: string;
  description: string;
  categories: string[];
  severity: string;
  fingerprint: string;
  location: { path: string; lines: { begin: number; end: number } };
}

describe('CodeclimateReporter', () => {
  it('1. empty issue list emits a well-formed JSON array', () => {
    const r = new CodeclimateReporter();
    const out = runReporter(r, SAMPLE_META, [], []);
    const parsed = JSON.parse(out) as CcIssue[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(0);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('2. fixture renders three issues with correct shape', () => {
    const r = new CodeclimateReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    const parsed = JSON.parse(out) as CcIssue[];
    expect(parsed.length).toBe(3);
    expect(parsed[0]?.type).toBe('issue');
    expect(parsed[0]?.check_name).toBe('unused-exports');
    expect(parsed[0]?.severity).toBe('major');
    expect(parsed[0]?.categories).toEqual(['Bug Risk']);
    expect(parsed[0]?.location.path).toBe('src/a.ts');
    expect(parsed[0]?.location.lines.begin).toBe(10);
  });

  it('3. severity ladder: error → major, warn → minor, off → info', () => {
    const r = new CodeclimateReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, []);
    const parsed = JSON.parse(out) as CcIssue[];
    const sevs = parsed.map((i) => i.severity);
    expect(sevs).toEqual(['major', 'minor', 'info']);
  });

  it('4. category mapping: complexity → Complexity, duplicate → Duplication', () => {
    const r = new CodeclimateReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, []);
    const parsed = JSON.parse(out) as CcIssue[];
    const byKind = new Map(parsed.map((i) => [i.check_name, i.categories]));
    expect(byKind.get('complexity-hotspot')).toEqual(['Complexity']);
    expect(byKind.get('duplicate-exports')).toEqual(['Duplication']);
    expect(byKind.get('unused-exports')).toEqual(['Bug Risk']);
  });

  it('5. fingerprint is sha1 of (kind:path:line:message)', () => {
    const r = new CodeclimateReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, []);
    const parsed = JSON.parse(out) as CcIssue[];
    const expected = createHash('sha1')
      .update("unused-exports:src/a.ts:10:Export 'foo' is never imported")
      .digest('hex');
    expect(parsed[0]?.fingerprint).toBe(expected);
  });

  it('6. determinism — 50 iterations all produce byte-equal output', () => {
    const baseline = runReporter(
      new CodeclimateReporter(),
      SAMPLE_META,
      SAMPLE_ISSUES,
      SAMPLE_EVENTS,
    );
    for (let i = 0; i < 50; i++) {
      const out = runReporter(new CodeclimateReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
      expect(out).toBe(baseline);
    }
  });

  it('7. shuffled-input issue list still sorts to the same output', () => {
    const baseline = runReporter(
      new CodeclimateReporter(),
      SAMPLE_META,
      SAMPLE_ISSUES,
      SAMPLE_EVENTS,
    );
    for (let seed = 1; seed <= 10; seed++) {
      const shuffled = shuffle(SAMPLE_ISSUES, seed);
      const out = runReporter(new CodeclimateReporter(), SAMPLE_META, shuffled, SAMPLE_EVENTS);
      expect(out).toBe(baseline);
    }
  });

  it('8. issue keys are stable: type, check_name, description, categories, severity, fingerprint, location', () => {
    const r = new CodeclimateReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, []);
    const parsed = JSON.parse(out) as CcIssue[];
    expect(Object.keys(parsed[0] as Record<string, unknown>)).toEqual([
      'type',
      'check_name',
      'description',
      'categories',
      'severity',
      'fingerprint',
      'location',
    ]);
  });

  it('9. boundary-violations maps to Style category', () => {
    const r = new CodeclimateReporter();
    const out = runReporter(
      r,
      SAMPLE_META,
      [
        {
          kind: 'boundary-violations',
          severity: 'error',
          file: '/tmp/proj/src/a.ts',
          range: {
            start: { line: 1, column: 0, byteOffset: 0 },
            end: { line: 1, column: 10, byteOffset: 10 },
          },
          message: 'app -> infra',
          from: '/tmp/proj/src/a.ts',
          to: '/tmp/proj/src/b.ts',
          fromZone: 'app',
          toZone: 'infra',
        },
      ],
      [],
    );
    const parsed = JSON.parse(out) as CcIssue[];
    expect(parsed[0]?.categories).toEqual(['Style']);
  });

  it('10. pretty-printed JSON with two-space indent', () => {
    const r = new CodeclimateReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, []);
    expect(out).toMatch(/^\[\n {2}\{/u);
  });
});
