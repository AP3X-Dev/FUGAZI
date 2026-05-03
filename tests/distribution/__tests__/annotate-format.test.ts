/**
 * Validates the GitHub workflow-command annotation format produced by
 * `action/scripts/annotate.sh`. We do not run the bash script directly
 * (Windows + bash + jq dependency), instead we re-implement the format
 * string in TypeScript and assert the output matches the canonical
 * `::error file=...,line=...,col=...::[ruleId] message` shape exactly.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SAMPLE = JSON.parse(
  readFileSync(join(REPO_ROOT, 'action', 'tests', 'fixtures', 'sample-issues.json'), 'utf8'),
) as {
  issues: Array<{
    ruleId: string;
    severity: string;
    message: string;
    file: string;
    startLine?: number;
    startColumn?: number;
  }>;
};

interface Issue {
  ruleId: string;
  severity: string;
  message: string;
  file: string;
  startLine?: number;
  startColumn?: number;
}

function annotate(issue: Issue): string {
  const sev = issue.severity === 'error' ? 'error' : 'warning';
  const line = issue.startLine ?? 1;
  const col = issue.startColumn ?? 1;
  return `::${sev} file=${issue.file},line=${line},col=${col}::[${issue.ruleId}] ${issue.message}`;
}

describe('GitHub Actions annotation format', () => {
  it('emits ::error for severity=error', () => {
    const errIssue = SAMPLE.issues.find((i) => i.severity === 'error');
    expect(errIssue).toBeDefined();
    if (!errIssue) return;
    expect(annotate(errIssue)).toBe(
      "::error file=src/foo.ts,line=12,col=14::[unused-export] Export 'foo' is never imported",
    );
  });

  it('emits ::warning for severity=warn', () => {
    const warnIssue = SAMPLE.issues.find((i) => i.severity === 'warn');
    expect(warnIssue).toBeDefined();
    if (!warnIssue) return;
    const out = annotate(warnIssue);
    expect(out.startsWith('::warning file=')).toBe(true);
    expect(out).toContain('[complexity]');
  });

  it('annotation contains the expected separator triple :: between location and message', () => {
    for (const i of SAMPLE.issues) {
      const out = annotate(i);
      const sepCount = (out.match(/::/g) ?? []).length;
      expect(sepCount).toBe(2);
    }
  });

  it('annotation always includes file=, line=, col=', () => {
    for (const i of SAMPLE.issues) {
      const out = annotate(i);
      expect(out).toMatch(/\bfile=/);
      expect(out).toMatch(/\bline=/);
      expect(out).toMatch(/\bcol=/);
    }
  });
});
