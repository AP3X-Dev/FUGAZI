/**
 * json.test.ts — Phase 3j — JsonReporter byte-equal output assertions.
 */

import { describe, expect, it } from 'vitest';
import { JsonReporter } from '../json.js';
import { SAMPLE_EVENTS, SAMPLE_ISSUES, SAMPLE_META } from './fixtures/sample-issues.js';
import { runReporter, shuffle } from './helpers.js';

const EXPECTED = `${JSON.stringify(
  {
    $schema: 'https://fugazi.dev/schemas/report-v1.json',
    version: '1.2.3',
    mode: 'full',
    issues: [
      {
        ruleId: 'unused-exports',
        severity: 'error',
        file: 'src/a.ts',
        line: 10,
        col: 1,
        endLine: 10,
        endCol: 17,
        message: "Export 'foo' is never imported",
      },
      {
        ruleId: 'complexity-hotspot',
        severity: 'warn',
        file: 'src/b.ts',
        line: 20,
        col: 5,
        endLine: 25,
        endCol: 5,
        message: 'Function exceeds cyclomatic threshold',
      },
      {
        ruleId: 'duplicate-exports',
        severity: 'off',
        file: 'src/b.ts',
        line: 30,
        col: 1,
        endLine: 30,
        endCol: 13,
        message: "Duplicate export 'Config'",
      },
    ],
    metrics: { issueCount: 3, fileCount: 2 },
    runtime: null,
    _meta: {
      projectRoot: '/tmp/proj',
      determinismHash: null,
      progressEventCount: 1,
    },
  },
  null,
  2,
)}\n`;

describe('JsonReporter', () => {
  it('1. empty issue list emits a well-formed JSON object', () => {
    const r = new JsonReporter();
    const out = runReporter(r, SAMPLE_META, [], []);
    const parsed = JSON.parse(out) as { issues: unknown[]; metrics: { issueCount: number } };
    expect(Array.isArray(parsed.issues)).toBe(true);
    expect(parsed.issues.length).toBe(0);
    expect(parsed.metrics.issueCount).toBe(0);
    // Trailing LF is part of the contract.
    expect(out.endsWith('\n')).toBe(true);
  });

  it('2. fixture renders byte-for-byte expected output', () => {
    const r = new JsonReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    expect(out).toBe(EXPECTED);
  });

  it('3. determinism — 50 iterations all produce byte-equal output', () => {
    const baseline = runReporter(new JsonReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    for (let i = 0; i < 50; i++) {
      const r = new JsonReporter();
      const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
      expect(out).toBe(baseline);
    }
  });

  it('4. shuffled-input issue list still sorts to the same output', () => {
    const baseline = runReporter(new JsonReporter(), SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    for (let seed = 1; seed <= 10; seed++) {
      const shuffled = shuffle(SAMPLE_ISSUES, seed);
      const out = runReporter(new JsonReporter(), SAMPLE_META, shuffled, SAMPLE_EVENTS);
      expect(out).toBe(baseline);
    }
  });

  it('5. top-level keys are stable: $schema, version, mode, issues, metrics, runtime, _meta', () => {
    const r = new JsonReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, SAMPLE_EVENTS);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      '$schema',
      'version',
      'mode',
      'issues',
      'metrics',
      'runtime',
      '_meta',
    ]);
  });

  it('6. issue keys are stable: ruleId, severity, file, line, col, endLine, endCol, message', () => {
    const r = new JsonReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, []);
    const parsed = JSON.parse(out) as { issues: ReadonlyArray<Record<string, unknown>> };
    expect(Object.keys(parsed.issues[0] as Record<string, unknown>)).toEqual([
      'ruleId',
      'severity',
      'file',
      'line',
      'col',
      'endLine',
      'endCol',
      'message',
    ]);
  });

  it('7. progressEventCount reflects the events emitted', () => {
    const r = new JsonReporter();
    const out = runReporter(
      r,
      SAMPLE_META,
      [],
      [
        { seq: 0, kind: 'discover.start' },
        { seq: 1, kind: 'discover.done', fileCount: 7 },
      ],
    );
    expect(JSON.parse(out)._meta.progressEventCount).toBe(2);
  });

  it('8. paths are project-relative + forward-slashed', () => {
    const r = new JsonReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, []);
    expect(out).toContain('"file": "src/a.ts"');
    expect(out).not.toContain('/tmp/proj/');
  });

  it('9. JSON is two-space-indented + trailing LF', () => {
    const r = new JsonReporter();
    const out = runReporter(r, SAMPLE_META, SAMPLE_ISSUES, []);
    expect(out).toMatch(/^\{\n {2}"\$schema":/u);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('10. Phase 4e T369 — surfaces metrics.filesByLang when meta supplies it', () => {
    const r = new JsonReporter();
    r.begin({ ...SAMPLE_META, filesByLang: { ts: 12, py: 3 } });
    const out = r.end();
    if (typeof out !== 'string') throw new Error('expected string');
    const parsed = JSON.parse(out) as { metrics: { filesByLang?: { ts: number; py: number } } };
    expect(parsed.metrics.filesByLang).toEqual({ ts: 12, py: 3 });
  });

  it('11. Phase 4e T369 — surfaces metrics.parseErrors when meta supplies it', () => {
    const r = new JsonReporter();
    r.begin({
      ...SAMPLE_META,
      parseErrors: { total: 5, byLang: { ts: 2, py: 3 } },
    });
    const out = r.end();
    if (typeof out !== 'string') throw new Error('expected string');
    const parsed = JSON.parse(out) as {
      metrics: { parseErrors?: { total: number; byLang: { ts: number; py: number } } };
    };
    expect(parsed.metrics.parseErrors).toEqual({
      total: 5,
      byLang: { ts: 2, py: 3 },
    });
  });

  it('12. Phase 4e T369 — backwards-compat: no filesByLang/parseErrors when meta omits them', () => {
    const r = new JsonReporter();
    const out = runReporter(r, SAMPLE_META, [], []);
    const parsed = JSON.parse(out) as { metrics: Record<string, unknown> };
    expect(parsed.metrics.filesByLang).toBeUndefined();
    expect(parsed.metrics.parseErrors).toBeUndefined();
  });

  it('13. Phase 4e T369 — updateMeta merges patch into the recorded meta before serialize', () => {
    const r = new JsonReporter();
    r.begin(SAMPLE_META);
    r.updateMeta({ filesByLang: { ts: 4, py: 7 } });
    const out = r.end();
    if (typeof out !== 'string') throw new Error('expected string');
    const parsed = JSON.parse(out) as { metrics: { filesByLang?: { ts: number; py: number } } };
    expect(parsed.metrics.filesByLang).toEqual({ ts: 4, py: 7 });
  });

  it('14. Phase 4e T369 — updateMeta is a shallow merge (does not lose existing fields)', () => {
    const r = new JsonReporter();
    r.begin(SAMPLE_META);
    r.updateMeta({ filesByLang: { ts: 1, py: 2 } });
    r.updateMeta({ parseErrors: { total: 0, byLang: { ts: 0, py: 0 } } });
    const out = r.end();
    if (typeof out !== 'string') throw new Error('expected string');
    const parsed = JSON.parse(out) as { metrics: Record<string, unknown> };
    expect(parsed.metrics.filesByLang).toEqual({ ts: 1, py: 2 });
    expect(parsed.metrics.parseErrors).toEqual({
      total: 0,
      byLang: { ts: 0, py: 0 },
    });
  });

  it('15. Phase 4e T369 — updateMeta after end() throws verbatim contract', () => {
    const r = new JsonReporter();
    r.begin(SAMPLE_META);
    r.end();
    expect(() => r.updateMeta({ filesByLang: { ts: 0, py: 0 } })).toThrowError(
      'reporter: updateMeta called out of sequence',
    );
  });
});
