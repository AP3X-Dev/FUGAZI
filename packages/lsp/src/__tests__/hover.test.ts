/**
 * hover.test.ts — Phase 3h.3 (T193-test) — issue-range hover.
 */

import type { DiscriminatedIssue } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import { MarkupKind } from 'vscode-languageserver';
import { RULE_EXPLANATIONS, buildHover, formatHoverMarkdown } from '../hover.js';

function mkIssue(overrides: Partial<DiscriminatedIssue> = {}): DiscriminatedIssue {
  return {
    kind: 'unused-exports',
    severity: 'error',
    file: '/proj/x.ts',
    range: {
      start: { line: 5, column: 2, byteOffset: 100 },
      end: { line: 5, column: 12, byteOffset: 110 },
    },
    message: 'unused-exports: foo in /proj/x.ts has no consumers',
    exportName: 'foo',
    ...overrides,
  } as DiscriminatedIssue;
}

describe('buildHover', () => {
  it('returns null when no issue is under the cursor', () => {
    const hover = buildHover({
      issues: [mkIssue()],
      position: { line: 99, character: 0 },
    });
    expect(hover).toBeNull();
  });

  it('returns hover for the issue covering the cursor (LSP 0-based)', () => {
    const hover = buildHover({
      issues: [mkIssue()],
      // Issue is at Fugazi line 5 (1-based) = LSP line 4 (0-based).
      position: { line: 4, character: 5 },
    });
    expect(hover).not.toBeNull();
    expect(hover?.range?.start.line).toBe(4);
    expect(hover?.range?.start.character).toBe(2);
  });

  it('returns null when cursor is left of the start column on the start line', () => {
    const hover = buildHover({
      issues: [mkIssue()],
      position: { line: 4, character: 0 },
    });
    expect(hover).toBeNull();
  });

  it('returns null when cursor is right of end column on end line', () => {
    const hover = buildHover({
      issues: [mkIssue()],
      position: { line: 4, character: 99 },
    });
    expect(hover).toBeNull();
  });

  it('skips issues with no range (file-level)', () => {
    const fileLevel: DiscriminatedIssue = {
      kind: 'unused-files',
      severity: 'error',
      file: '/proj/x.ts',
      message: 'unused-files: /proj/x.ts is unreachable',
      path: '/proj/x.ts',
    };
    const hover = buildHover({
      issues: [fileLevel],
      position: { line: 0, character: 0 },
    });
    expect(hover).toBeNull();
  });
});

describe('formatHoverMarkdown', () => {
  it('emits Markdown content with verbatim message + rule explanation', () => {
    const md = formatHoverMarkdown(mkIssue());
    expect(md.kind).toBe(MarkupKind.Markdown);
    expect(md.value).toContain('**unused-exports** — error');
    expect(md.value).toContain('unused-exports: foo in /proj/x.ts has no consumers');
    expect(md.value).toContain(RULE_EXPLANATIONS['unused-exports']);
  });
});

describe('RULE_EXPLANATIONS', () => {
  it('covers every RuleId', () => {
    // 19 RuleIds — see packages/types/src/rule-id.ts.
    expect(Object.keys(RULE_EXPLANATIONS)).toHaveLength(19);
  });
});
