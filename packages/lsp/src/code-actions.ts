/**
 * code-actions.ts — Phase 3h.3 (T194) — suppression code-action builders.
 *
 * For every diagnostic at the cursor we surface two `quickfix` actions:
 *
 *   1. "Suppress with `// fugazi-ignore-next-line <ruleId>`" — inserts the
 *      directive on the line immediately above the diagnostic range.
 *   2. "Suppress for whole file with `// fugazi-ignore-file <ruleId>`" — inserts
 *      the directive at the very top of the file (line 0, character 0).
 *
 * Auto-fix actions for `unused-imports` and friends are deferred to Phase 3h.6.
 * v1 emits only suppression actions.
 */

import type {
  CodeAction,
  Diagnostic,
  Range as LspRange,
  TextEdit,
  WorkspaceEdit,
} from 'vscode-languageserver';
import { CodeActionKind } from 'vscode-languageserver';
import { DIAGNOSTIC_SOURCE } from './diagnostics.js';

interface BuildContext {
  readonly uri: string;
  readonly diagnostic: Diagnostic;
}

/** Build the two suppression code actions for one diagnostic. */
export function buildSuppressionActions(ctx: BuildContext): readonly CodeAction[] {
  if (ctx.diagnostic.source !== DIAGNOSTIC_SOURCE) return [];
  const code = ctx.diagnostic.code;
  if (typeof code !== 'string' || code.length === 0) return [];
  return [buildNextLineAction(ctx, code), buildFileAction(ctx, code)];
}

/** Build all suppression actions for every Fugazi diagnostic at a cursor range. */
export function buildSuppressionActionsForRange(
  uri: string,
  diagnostics: readonly Diagnostic[],
  cursorRange: LspRange,
): readonly CodeAction[] {
  const out: CodeAction[] = [];
  for (const diag of diagnostics) {
    if (!rangesIntersect(diag.range, cursorRange)) continue;
    for (const action of buildSuppressionActions({ uri, diagnostic: diag })) {
      out.push(action);
    }
  }
  return out;
}

function buildNextLineAction(ctx: BuildContext, ruleId: string): CodeAction {
  const line = ctx.diagnostic.range.start.line;
  const text = `// fugazi-ignore-next-line ${ruleId}\n`;
  const edit: TextEdit = {
    range: { start: { line, character: 0 }, end: { line, character: 0 } },
    newText: text,
  };
  const workspaceEdit: WorkspaceEdit = { changes: { [ctx.uri]: [edit] } };
  return {
    title: `Suppress with // fugazi-ignore-next-line ${ruleId}`,
    kind: CodeActionKind.QuickFix,
    diagnostics: [ctx.diagnostic],
    edit: workspaceEdit,
  };
}

function buildFileAction(ctx: BuildContext, ruleId: string): CodeAction {
  const text = `// fugazi-ignore-file ${ruleId}\n`;
  const edit: TextEdit = {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    newText: text,
  };
  const workspaceEdit: WorkspaceEdit = { changes: { [ctx.uri]: [edit] } };
  return {
    title: `Suppress for whole file with // fugazi-ignore-file ${ruleId}`,
    kind: CodeActionKind.QuickFix,
    diagnostics: [ctx.diagnostic],
    edit: workspaceEdit,
  };
}

function rangesIntersect(a: LspRange, b: LspRange): boolean {
  // Half-open intersection; touching endpoints DO count as overlap so a cursor
  // sitting on the closing brace of a finding still surfaces the action.
  if (a.end.line < b.start.line) return false;
  if (a.start.line > b.end.line) return false;
  if (a.end.line === b.start.line && a.end.character < b.start.character) return false;
  if (a.start.line === b.end.line && a.start.character > b.end.character) return false;
  return true;
}
