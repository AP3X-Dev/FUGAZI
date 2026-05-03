/**
 * progress.test.ts — Phase 3h.3 (T190) — workDoneProgress translation.
 */

import type { ProgressEvent } from '@fugazi/core';
import { describe, expect, it, vi } from 'vitest';
import { type ProgressReporter, makeProgressBridge } from '../progress.js';

function spyReporter(): ProgressReporter & {
  events: { kind: string; args: unknown[] }[];
} {
  const events: { kind: string; args: unknown[] }[] = [];
  return {
    events,
    begin: vi.fn((token: string, title: string) => {
      events.push({ kind: 'begin', args: [token, title] });
    }),
    report: vi.fn((token: string, pct: number | undefined, msg: string | undefined) => {
      events.push({ kind: 'report', args: [token, pct, msg] });
    }),
    end: vi.fn((token: string, message: string | undefined) => {
      events.push({ kind: 'end', args: [token, message] });
    }),
  };
}

describe('makeProgressBridge', () => {
  it('emits begin on discover.start and end on crossref.done', () => {
    const reporter = spyReporter();
    const bridge = makeProgressBridge(reporter, 'tok');
    bridge({ seq: 0, kind: 'discover.start' } satisfies ProgressEvent);
    bridge({ seq: 1, kind: 'discover.done', fileCount: 5 } satisfies ProgressEvent);
    bridge({ seq: 2, kind: 'crossref.done' } satisfies ProgressEvent);
    expect(reporter.events[0]?.kind).toBe('begin');
    expect(reporter.events.at(-1)?.kind).toBe('end');
  });

  it('emits monotonically non-decreasing percentages across a normal run', () => {
    const reporter = spyReporter();
    const bridge = makeProgressBridge(reporter, 'tok');
    const pcts: number[] = [];
    const captured = vi.fn((_t: string, p: number | undefined, _m: string | undefined) => {
      if (p !== undefined) pcts.push(p);
    });
    reporter.report = captured;

    const events: readonly ProgressEvent[] = [
      { seq: 0, kind: 'discover.start' },
      { seq: 1, kind: 'discover.done', fileCount: 5 },
      { seq: 2, kind: 'extract.start', total: 5 },
      { seq: 3, kind: 'extract.progress', n: 3, total: 5 },
      { seq: 4, kind: 'extract.done' },
      { seq: 5, kind: 'graph.start' },
      { seq: 6, kind: 'graph.done', edgeCount: 10 },
      { seq: 7, kind: 'analyze.start', ruleCount: 14 },
      { seq: 8, kind: 'analyze.progress', rule: 'unused-files', n: 7, total: 14 },
      { seq: 9, kind: 'analyze.done' },
    ];
    for (const e of events) bridge(e);

    expect(pcts.length).toBeGreaterThan(0);
    for (let i = 1; i < pcts.length; i++) {
      const prev = pcts[i - 1] ?? 0;
      const cur = pcts[i] ?? 0;
      expect(cur).toBeGreaterThanOrEqual(prev);
    }
  });

  it('handles runtime.start / runtime.done without re-begin if already begun', () => {
    const reporter = spyReporter();
    const bridge = makeProgressBridge(reporter, 'tok');
    bridge({ seq: 0, kind: 'discover.start' } satisfies ProgressEvent);
    bridge({ seq: 1, kind: 'crossref.done' } satisfies ProgressEvent);
    bridge({ seq: 2, kind: 'runtime.start' } satisfies ProgressEvent);
    bridge({ seq: 3, kind: 'runtime.done' } satisfies ProgressEvent);
    // Two begin calls — one per `discover.start`, one per `runtime.start`
    // because the first one ended.
    const begins = reporter.events.filter((e) => e.kind === 'begin').length;
    expect(begins).toBe(2);
  });
});
