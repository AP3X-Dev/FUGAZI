/**
 * code-actions.test.ts — Phase 3h.3 (T193-test) — suppression code-action
 * generation.
 */

import { describe, expect, it } from 'vitest';
import { CodeActionKind, type Diagnostic } from 'vscode-languageserver';
import { buildSuppressionActions, buildSuppressionActionsForRange } from '../code-actions.js';
import { DIAGNOSTIC_SOURCE } from '../diagnostics.js';

function mkDiag(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    severity: 1,
    range: {
      start: { line: 4, character: 2 },
      end: { line: 4, character: 12 },
    },
    code: 'unused-exports',
    source: DIAGNOSTIC_SOURCE,
    message: 'unused-exports: foo in /proj/x.ts has no consumers',
    ...overrides,
  };
}

describe('buildSuppressionActions', () => {
  it('emits exactly two quickfix actions per Fugazi diagnostic', () => {
    const actions = buildSuppressionActions({
      uri: 'file:///proj/x.ts',
      diagnostic: mkDiag(),
    });
    expect(actions).toHaveLength(2);
    expect(actions.every((a) => a.kind === CodeActionKind.QuickFix)).toBe(true);
  });

  it('first action inserts // fugazi-ignore-next-line on the diagnostic line', () => {
    const actions = buildSuppressionActions({
      uri: 'file:///proj/x.ts',
      diagnostic: mkDiag(),
    });
    const action = actions[0];
    expect(action?.title).toBe('Suppress with // fugazi-ignore-next-line unused-exports');
    const edits = action?.edit?.changes?.['file:///proj/x.ts'];
    expect(edits).toBeDefined();
    expect(edits?.[0]?.newText).toBe('// fugazi-ignore-next-line unused-exports\n');
    expect(edits?.[0]?.range.start).toEqual({ line: 4, character: 0 });
  });

  it('second action inserts // fugazi-ignore-file at line 0', () => {
    const actions = buildSuppressionActions({
      uri: 'file:///proj/x.ts',
      diagnostic: mkDiag(),
    });
    const action = actions[1];
    expect(action?.title).toBe('Suppress for whole file with // fugazi-ignore-file unused-exports');
    const edits = action?.edit?.changes?.['file:///proj/x.ts'];
    expect(edits?.[0]?.newText).toBe('// fugazi-ignore-file unused-exports\n');
    expect(edits?.[0]?.range.start).toEqual({ line: 0, character: 0 });
  });

  it('emits zero actions for non-Fugazi diagnostics', () => {
    const actions = buildSuppressionActions({
      uri: 'file:///proj/x.ts',
      diagnostic: mkDiag({ source: 'tsserver' }),
    });
    expect(actions).toHaveLength(0);
  });

  it('emits zero actions when the code field is empty', () => {
    const actions = buildSuppressionActions({
      uri: 'file:///proj/x.ts',
      diagnostic: mkDiag({ code: '' }),
    });
    expect(actions).toHaveLength(0);
  });

  it('attaches the diagnostic on the action so the editor can reuse it', () => {
    const diag = mkDiag();
    const [first, second] = buildSuppressionActions({ uri: 'file:///proj/x.ts', diagnostic: diag });
    expect(first?.diagnostics).toEqual([diag]);
    expect(second?.diagnostics).toEqual([diag]);
  });
});

describe('buildSuppressionActionsForRange', () => {
  it('emits actions only for diagnostics intersecting the cursor range', () => {
    const a = mkDiag({
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
    });
    const b = mkDiag({
      range: { start: { line: 10, character: 0 }, end: { line: 10, character: 5 } },
    });
    const cursor = { start: { line: 1, character: 2 }, end: { line: 1, character: 2 } };
    const actions = buildSuppressionActionsForRange('file:///proj/x.ts', [a, b], cursor);
    // Only `a` is at the cursor; 2 actions per matching diagnostic.
    expect(actions).toHaveLength(2);
  });

  it('returns no actions when the cursor is outside every diagnostic range', () => {
    const a = mkDiag({
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
    });
    const cursor = { start: { line: 99, character: 0 }, end: { line: 99, character: 0 } };
    const actions = buildSuppressionActionsForRange('file:///proj/x.ts', [a], cursor);
    expect(actions).toHaveLength(0);
  });
});
