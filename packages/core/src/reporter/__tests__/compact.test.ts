/**
 * compact.test.ts — Phase 3j — CompactReporter byte-equal output assertions.
 */

import { describe, expect, it } from 'vitest';
import { CompactReporter } from '../compact.js';
import { SAMPLE_EVENTS, SAMPLE_ISSUES, SAMPLE_META } from './fixtures/sample-issues.js';
import { runReporter, shuffle } from './helpers.js';

const EXPECTED =
  "src/a.ts:10:1:error:unused-exports:Export 'foo' is never imported\n" +
  'src/b.ts:20:5:warning:complexity-hotspot:Function exceeds cyclomatic threshold\n' +
  "src/b.ts:30:1:note:duplicate-exports:Duplicate export 'Config'\n";

describe('CompactReporter', () => {
  it('1. empty issue list serializes to the empty string', () => {
    const r = new CompactReporter();
    const out = runReporter(r, SAMPLE_META, [], []);
    expect(out).toBe('');
  });

  it('2. fixture renders byte-for-byte expected output', () => {
    const r = new CompactReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    expect(out).toBe(EXPECTED);
  });

  it('3. severity wire format: error / warning / note', () => {
    const r = new CompactReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, []);
    expect(out).toContain(':error:');
    expect(out).toContain(':warning:');
    expect(out).toContain(':note:');
  });

  it('4. determinism — 50 iterations all produce byte-equal output', () => {
    const baseline = runReporter(new CompactReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    for (let i = 0; i < 50; i++) {
      const r = new CompactReporter();
      const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
      expect(out).toBe(baseline);
    }
  });

  it('5. shuffled-input issue list still sorts to the same output', () => {
    const baseline = runReporter(new CompactReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    for (let seed = 1; seed <= 10; seed++) {
      const shuffled = shuffle(SAMPLE_ISSUES, seed);
      const r = new CompactReporter();
      expect(runReporter(r, SAMPLE_META, shuffled, SAMPLE_EVENTS)).toBe(baseline);
    }
  });

  it('6. no header, no footer — line count equals issue count', () => {
    const r = new CompactReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    const lines = out.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(SAMPLE_ISSUES.length);
  });

  it('7. project-relative paths strip projectRoot prefix', () => {
    const r = new CompactReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, []);
    expect(out).not.toContain('/tmp/proj/');
    expect(out).toContain('src/a.ts');
  });

  it('8. paths outside projectRoot are preserved verbatim', () => {
    const r = new CompactReporter();
    const out = runReporter(
      r,
      SAMPLE_META,
      [
        {
          kind: 'unused-files',
          severity: 'warn',
          file: '/elsewhere/x.ts',
          message: 'unused file',
          path: '/elsewhere/x.ts',
        },
      ],
      [],
    );
    expect(out).toBe('/elsewhere/x.ts:1:1:warning:unused-files:unused file\n');
  });

  it('9. column is 1-indexed (LSP semantics → wire format)', () => {
    const r = new CompactReporter();
    // Index 0 in SAMPLE_ISSUES is the b.ts:20 complexity-hotspot with column 4.
    const issue = SAMPLE_ISSUES[0] as never;
    const out = runReporter(r, SAMPLE_META, [issue], []);
    // Source column 4 → wire column 5.
    expect(out).toContain(':20:5:');
  });
});
