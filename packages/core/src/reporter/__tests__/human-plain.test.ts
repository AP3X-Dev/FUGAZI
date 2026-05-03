/**
 * human-plain.test.ts — Phase 3j — HumanPlainReporter byte-equal tests.
 */

import { describe, expect, it } from 'vitest';
import { HumanPlainReporter } from '../human-plain.js';
import { SAMPLE_EVENTS, SAMPLE_ISSUES, SAMPLE_META } from './fixtures/sample-issues.js';
import { runReporter, shuffle } from './helpers.js';

const EXPECTED =
  'Fugazi v1.2.3 — full mode\n' +
  '\n' +
  'Dead code\n' +
  '  unused exports (1)\n' +
  "    src/a.ts:10:1  error  Export 'foo' is never imported\n" +
  '\n' +
  'Duplicates\n' +
  '  duplicate exports (1)\n' +
  "    src/b.ts:30:1  off  Duplicate export 'Config'\n" +
  '\n' +
  'Health\n' +
  '  complexity hotspots (1)\n' +
  '    src/b.ts:20:5  warn  Function exceeds cyclomatic threshold\n' +
  '\n' +
  '3 issues found across 2 files in 0ms\n';

describe('HumanPlainReporter', () => {
  it('1. empty issue list emits header + "No issues found." + footer', () => {
    const r = new HumanPlainReporter();
    const out = runReporter(r, SAMPLE_META, [], []);
    expect(out).toContain('Fugazi v1.2.3');
    expect(out).toContain('No issues found.');
    expect(out).toContain('0 issues found across 0 files in 0ms');
  });

  it('2. fixture renders byte-for-byte expected output', () => {
    const r = new HumanPlainReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    expect(out).toBe(EXPECTED);
  });

  it('3. plain output contains no ANSI escape sequences', () => {
    const r = new HumanPlainReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    // Look for any ESC byte (0x1b).
    expect(out.indexOf('\x1b')).toBe(-1);
  });

  it('4. determinism — 50 iterations all produce byte-equal output', () => {
    const baseline = runReporter(
      new HumanPlainReporter(),
      SAMPLE_META,
      SAMPLE_ISSUES,
      SAMPLE_EVENTS,
    );
    for (let i = 0; i < 50; i++) {
      const out = runReporter(new HumanPlainReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
      expect(out).toBe(baseline);
    }
  });

  it('5. shuffled-input issue list still sorts to the same output', () => {
    const baseline = runReporter(
      new HumanPlainReporter(),
      SAMPLE_META,
      SAMPLE_ISSUES,
      SAMPLE_EVENTS,
    );
    for (let seed = 1; seed <= 10; seed++) {
      const shuffled = shuffle(SAMPLE_ISSUES, seed);
      const out = runReporter(new HumanPlainReporter(), SAMPLE_META, shuffled, SAMPLE_EVENTS);
      expect(out).toBe(baseline);
    }
  });

  it('6. section headers appear in canonical order: Dead code, Duplicates, Health', () => {
    const r = new HumanPlainReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    const dead = out.indexOf('Dead code');
    const dupe = out.indexOf('Duplicates');
    const health = out.indexOf('Health');
    expect(dead).toBeGreaterThan(0);
    expect(dupe).toBeGreaterThan(dead);
    expect(health).toBeGreaterThan(dupe);
  });

  it('7. file paths are project-relative', () => {
    const r = new HumanPlainReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    expect(out).toContain('src/a.ts:10:1');
    expect(out).not.toContain('/tmp/proj/');
  });

  it('8. footer reports total issue + file counts', () => {
    const r = new HumanPlainReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    expect(out).toContain('3 issues found across 2 files');
  });
});
