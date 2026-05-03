/**
 * diagnostics.test.ts — Phase 3h.3 (T191-test) — issue → Diagnostic conversion
 * + per-URI debouncer.
 */

import type { DiscriminatedIssue } from '@fugazi/types';
import { describe, expect, it, vi } from 'vitest';
import { DiagnosticSeverity } from 'vscode-languageserver';
import {
  DEBOUNCE_MS,
  DIAGNOSTIC_SOURCE,
  PerUriDebouncer,
  groupIssuesByFile,
  issueToDiagnostic,
  issuesToDiagnostics,
} from '../diagnostics.js';

function mkIssue(overrides: Partial<DiscriminatedIssue> = {}): DiscriminatedIssue {
  return {
    kind: 'unused-exports',
    severity: 'error',
    file: '/proj/src/x.ts',
    range: {
      start: { line: 5, column: 2, byteOffset: 100 },
      end: { line: 5, column: 12, byteOffset: 110 },
    },
    message: 'unused-exports: foo in /proj/src/x.ts has no consumers',
    exportName: 'foo',
    ...overrides,
  } as DiscriminatedIssue;
}

describe('issueToDiagnostic — line/column conversion', () => {
  it('converts 1-based line to 0-based; preserves UTF-16 column', () => {
    const diag = issueToDiagnostic(mkIssue());
    expect(diag.range.start.line).toBe(4);
    expect(diag.range.start.character).toBe(2);
    expect(diag.range.end.line).toBe(4);
    expect(diag.range.end.character).toBe(12);
  });

  it('emits Error severity for "error" issues', () => {
    const diag = issueToDiagnostic(mkIssue({ severity: 'error' }));
    expect(diag.severity).toBe(DiagnosticSeverity.Error);
  });

  it('emits Warning severity for "warn" issues', () => {
    const diag = issueToDiagnostic(mkIssue({ severity: 'warn' }));
    expect(diag.severity).toBe(DiagnosticSeverity.Warning);
  });

  it('carries the rule kind as the diagnostic code', () => {
    const diag = issueToDiagnostic(mkIssue());
    expect(diag.code).toBe('unused-exports');
  });

  it('advertises "fugazi" as the source', () => {
    const diag = issueToDiagnostic(mkIssue());
    expect(diag.source).toBe(DIAGNOSTIC_SOURCE);
  });

  it('preserves the verbatim message', () => {
    const issue = mkIssue();
    const diag = issueToDiagnostic(issue);
    expect(diag.message).toBe(issue.message);
  });

  it('collapses missing range to (0,0)-(0,0)', () => {
    // unused-files is the only file-level kind without a `range` key.
    const issue: DiscriminatedIssue = {
      kind: 'unused-files',
      severity: 'error',
      file: '/proj/orphan.ts',
      message: 'unused-files: /proj/orphan.ts is unreachable',
      path: '/proj/orphan.ts',
    };
    const diag = issueToDiagnostic(issue);
    expect(diag.range.start).toEqual({ line: 0, character: 0 });
    expect(diag.range.end).toEqual({ line: 0, character: 0 });
  });

  it('does not allow negative line/character values', () => {
    const diag = issueToDiagnostic(
      mkIssue({
        range: {
          start: { line: 0, column: 0, byteOffset: 0 },
          end: { line: 0, column: 0, byteOffset: 0 },
        },
      }),
    );
    expect(diag.range.start.line).toBe(0);
    expect(diag.range.end.line).toBe(0);
  });
});

describe('issuesToDiagnostics', () => {
  it('drops off-severity issues', () => {
    const out = issuesToDiagnostics([mkIssue({ severity: 'off' })]);
    expect(out).toHaveLength(0);
  });

  it('keeps error+warn diagnostics', () => {
    const out = issuesToDiagnostics([
      mkIssue({ severity: 'error' }),
      mkIssue({ severity: 'warn' }),
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('groupIssuesByFile', () => {
  it('buckets issues by their `file` field', () => {
    const issues: readonly DiscriminatedIssue[] = [
      mkIssue({ file: '/proj/a.ts' }),
      mkIssue({ file: '/proj/b.ts' }),
      mkIssue({ file: '/proj/a.ts' }),
    ];
    const grouped = groupIssuesByFile(issues);
    expect(grouped.size).toBe(2);
    expect(grouped.get('/proj/a.ts')?.length).toBe(2);
    expect(grouped.get('/proj/b.ts')?.length).toBe(1);
  });
});

describe('PerUriDebouncer', () => {
  it('exposes the spec-default 500ms window', () => {
    expect(DEBOUNCE_MS).toBe(500);
  });

  it('coalesces three rapid edits into one fire', async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const dbnc = new PerUriDebouncer(100);
      dbnc.schedule('uri:a', fn);
      dbnc.schedule('uri:a', fn);
      dbnc.schedule('uri:a', fn);
      expect(dbnc.pending).toBe(1);
      vi.advanceTimersByTime(99);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(2);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(dbnc.pending).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('schedules independently per URI', () => {
    vi.useFakeTimers();
    try {
      const fnA = vi.fn();
      const fnB = vi.fn();
      const dbnc = new PerUriDebouncer(100);
      dbnc.schedule('uri:a', fnA);
      dbnc.schedule('uri:b', fnB);
      expect(dbnc.pending).toBe(2);
      vi.advanceTimersByTime(101);
      expect(fnA).toHaveBeenCalledTimes(1);
      expect(fnB).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel() suppresses a pending fire', () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const dbnc = new PerUriDebouncer(100);
      dbnc.schedule('uri:a', fn);
      dbnc.cancel('uri:a');
      vi.advanceTimersByTime(200);
      expect(fn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancelAll() clears every timer', () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const dbnc = new PerUriDebouncer(100);
      dbnc.schedule('uri:a', fn);
      dbnc.schedule('uri:b', fn);
      dbnc.schedule('uri:c', fn);
      expect(dbnc.pending).toBe(3);
      dbnc.cancelAll();
      expect(dbnc.pending).toBe(0);
      vi.advanceTimersByTime(200);
      expect(fn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
