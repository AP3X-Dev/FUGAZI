/**
 * code-lens.test.ts — Phase 3h.3 (T193-test) — per-file CodeLens.
 */

import type { DiscriminatedIssue } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import { buildFileCodeLenses } from '../code-lens.js';

function mkIssue(overrides: Partial<DiscriminatedIssue> = {}): DiscriminatedIssue {
  return {
    kind: 'unused-exports',
    severity: 'error',
    file: '/proj/x.ts',
    range: {
      start: { line: 1, column: 0, byteOffset: 0 },
      end: { line: 1, column: 5, byteOffset: 5 },
    },
    message: 'unused-exports: foo in /proj/x.ts has no consumers',
    exportName: 'foo',
    ...overrides,
  } as DiscriminatedIssue;
}

describe('buildFileCodeLenses', () => {
  it('returns no lens for a file with zero issues', () => {
    expect(buildFileCodeLenses([])).toEqual([]);
  });

  it('returns no lens when every issue is severity:off', () => {
    expect(buildFileCodeLenses([mkIssue({ severity: 'off' })])).toEqual([]);
  });

  it('one lens at line 0 with the correct title for a single issue', () => {
    const lenses = buildFileCodeLenses([mkIssue()]);
    expect(lenses).toHaveLength(1);
    expect(lenses[0]?.command?.title).toBe('Fugazi: 1 issue');
    expect(lenses[0]?.range.start.line).toBe(0);
  });

  it('plural form for >=2 issues', () => {
    const lenses = buildFileCodeLenses([mkIssue(), mkIssue(), mkIssue()]);
    expect(lenses[0]?.command?.title).toBe('Fugazi: 3 issues');
  });

  it('command id is fugazi.showDiagnostics', () => {
    const [lens] = buildFileCodeLenses([mkIssue()]);
    expect(lens?.command?.command).toBe('fugazi.showDiagnostics');
  });
});
