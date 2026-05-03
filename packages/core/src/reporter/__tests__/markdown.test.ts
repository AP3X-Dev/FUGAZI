/**
 * markdown.test.ts — Phase 3j — MarkdownReporter byte-equal output assertions.
 */

import { describe, expect, it } from 'vitest';
import { MarkdownReporter } from '../markdown.js';
import { SAMPLE_EVENTS, SAMPLE_ISSUES, SAMPLE_META } from './fixtures/sample-issues.js';
import { runReporter, shuffle } from './helpers.js';

describe('MarkdownReporter', () => {
  it('1. empty issue list emits a well-formed report skeleton', () => {
    const r = new MarkdownReporter();
    const out = runReporter(r, SAMPLE_META, [], []);
    expect(out).toContain('# Fugazi Report');
    expect(out).toContain('## Summary');
    expect(out).toContain('- 0 issues across 0 files');
    expect(out).toContain('## Diagnostics by rule');
    // No section bodies emitted when empty.
    expect(out).not.toContain('## Dead code');
    expect(out).not.toContain('## Duplicates');
    expect(out).not.toContain('## Health');
  });

  it('2. fixture renders all expected sections', () => {
    const r = new MarkdownReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    expect(out).toContain('# Fugazi Report — full');
    expect(out).toContain('Tool version: `1.2.3`');
    expect(out).toContain('## Summary');
    expect(out).toContain('- 3 issues across 2 files');
    expect(out).toContain('## Dead code');
    expect(out).toContain('### Unused exports');
    expect(out).toContain('## Duplicates');
    expect(out).toContain('### Duplicate exports');
    expect(out).toContain('## Health');
    expect(out).toContain('### Complexity hotspots');
  });

  it('3. determinism — 50 iterations all produce byte-equal output', () => {
    const baseline = runReporter(new MarkdownReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    for (let i = 0; i < 50; i++) {
      const out = runReporter(new MarkdownReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
      expect(out).toBe(baseline);
    }
  });

  it('4. shuffled-input issue list still sorts to the same output', () => {
    const baseline = runReporter(new MarkdownReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    for (let seed = 1; seed <= 10; seed++) {
      const shuffled = shuffle(SAMPLE_ISSUES, seed);
      const out = runReporter(new MarkdownReporter(), SAMPLE_META, shuffled, SAMPLE_EVENTS);
      expect(out).toBe(baseline);
    }
  });

  it('5. table rows use GFM pipe syntax with file in code-span', () => {
    const r = new MarkdownReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, []);
    expect(out).toContain('| `src/a.ts` |');
    expect(out).toContain('| File | Line | Message |');
    expect(out).toContain('| --- | --- | --- |');
  });

  it('6. diagnostics-by-rule table has one row per distinct ruleId', () => {
    const r = new MarkdownReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, []);
    expect(out).toContain('| `unused-exports` | 1 |');
    expect(out).toContain('| `complexity-hotspot` | 1 |');
    expect(out).toContain('| `duplicate-exports` | 1 |');
  });

  it('7. pipe-character escaping in messages does not break tables', () => {
    const r = new MarkdownReporter();
    const out = runReporter(
      r,
      SAMPLE_META,
      [
        {
          kind: 'unused-files',
          severity: 'warn',
          file: '/tmp/proj/src/x.ts',
          message: 'a | b | c',
          path: '/tmp/proj/src/x.ts',
        },
      ],
      [],
    );
    // The message should be pipe-escaped.
    expect(out).toContain('a \\| b \\| c');
  });

  it('8. no emojis in the output', () => {
    const r = new MarkdownReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, []);
    // Anything in the unicode emoji block should not be present.
    expect(out).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(out).not.toMatch(/[☀-➿]/u);
  });

  it('9. project-relative paths in code-spans', () => {
    const r = new MarkdownReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, []);
    expect(out).toContain('| `src/a.ts` |');
    expect(out).not.toContain('| `/tmp/proj/');
  });
});
