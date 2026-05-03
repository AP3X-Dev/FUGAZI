/**
 * code-lens.ts — Phase 3h.3 (T194) — per-file issue-count CodeLens.
 *
 * One CodeLens per file at line 0. Title format: `Fugazi: <N> issue(s)`. The
 * resolver is a no-op — clicking the lens does not navigate anywhere in v1.
 * IDEs that surface a default click handler typically open the diagnostics
 * panel, which is the desired UX.
 */

import type { DiscriminatedIssue } from '@fugazi/types';
import type { CodeLens } from 'vscode-languageserver';

/**
 * Build the file-level CodeLens for a URI. Returns an empty array when there
 * are zero issues — IDEs typically suppress the rendered range when no lens is
 * returned, which is preferable to showing "Fugazi: 0 issues" everywhere.
 */
export function buildFileCodeLenses(issues: readonly DiscriminatedIssue[]): readonly CodeLens[] {
  if (issues.length === 0) return [];
  const visible = issues.filter((i) => i.severity !== 'off');
  if (visible.length === 0) return [];
  const title = visible.length === 1 ? 'Fugazi: 1 issue' : `Fugazi: ${visible.length} issues`;
  const lens: CodeLens = {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    command: { title, command: 'fugazi.showDiagnostics' },
  };
  return [lens];
}
