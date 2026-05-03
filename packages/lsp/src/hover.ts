/**
 * hover.ts — Phase 3h.3 (T194) — issue-range hover formatter.
 *
 * Hovering over a position covered by a Fugazi diagnostic returns a Markdown
 * payload: the issue's verbatim message + a link to the rule explanation.
 *
 * The rule-description map is duplicated here (rather than imported from the
 * MCP package) because LSP must not depend on `@fugazi/mcp` — that package is
 * an opt-in transport surface, not a dependency of every IDE integration. The
 * map mirrors `packages/mcp/src/rule-descriptions.ts`; keep both in sync.
 */

import type { DiscriminatedIssue, Position as FugaziPosition, RuleId } from '@fugazi/types';
import type {
  Hover,
  Position as LspPosition,
  Range as LspRange,
  MarkupContent,
} from 'vscode-languageserver';
import { MarkupKind } from 'vscode-languageserver';

/**
 * Inline rule-explanation map. One short Markdown blurb per RuleId. Duplicated
 * intentionally — see file header.
 */
export const RULE_EXPLANATIONS: Readonly<Record<RuleId, string>> = {
  'unused-files': 'Files unreachable from any declared entry point.',
  'unused-exports': 'Exported bindings with no incoming graph edge.',
  'unused-types': 'Exported types/interfaces whose only consumers are also unused.',
  'unused-deps': 'Manifest dependencies never imported by project source.',
  'unused-dev-deps': 'devDependencies entries with no project import.',
  'unused-optional-deps': 'optionalDependencies entries with no usage.',
  'unused-enum-members': 'Enum members never referenced by any consumer.',
  'unused-class-members': 'Private/protected class members with no in-class reference.',
  'circular-dependencies': 'Cycles in the static-import graph.',
  'boundary-violations': 'Imports that cross a configured zone boundary.',
  'unresolved-imports': 'Specifiers that resolve to no project file or package.',
  'unlisted-dependencies': 'Imports of bare specifiers not in package.json.',
  'duplicate-exports': 'Multiple exports under the same name in the same module.',
  'private-type-leak': 'Public exports referencing a non-exported type.',
  'complexity-hotspot': 'Functions exceeding the cyclomatic-complexity threshold.',
  'cognitive-complexity': 'Functions exceeding the cognitive-complexity threshold.',
  'code-duplication': 'Clone families across files.',
  'cold-code': 'Code with measured zero or near-zero execution coverage.',
  'hot-path': 'Files dominating measured production CPU/wall time.',
};

interface HoverContext {
  readonly issues: readonly DiscriminatedIssue[];
  readonly position: LspPosition;
}

/**
 * Build the hover payload for the first issue whose range covers the cursor.
 * Returns `null` when no issue is under the cursor — the LSP framework treats
 * `null` as "no hover content".
 */
export function buildHover(ctx: HoverContext): Hover | null {
  for (const issue of ctx.issues) {
    if (issue.range === undefined) continue;
    if (!positionInFugaziRange(ctx.position, issue.range.start, issue.range.end)) continue;
    return {
      contents: formatHoverMarkdown(issue),
      range: toLspRange(issue.range),
    };
  }
  return null;
}

export function formatHoverMarkdown(issue: DiscriminatedIssue): MarkupContent {
  const explanation = RULE_EXPLANATIONS[issue.kind];
  const lines = [
    `**${issue.kind}** — ${issue.severity}`,
    '',
    issue.message,
    '',
    `_${explanation}_`,
  ];
  return { kind: MarkupKind.Markdown, value: lines.join('\n') };
}

function positionInFugaziRange(
  pos: LspPosition,
  start: FugaziPosition,
  end: FugaziPosition,
): boolean {
  // Fugazi positions are 1-based line, 0-based UTF-16 col. LSP positions are
  // 0-based on both axes. Convert before comparing.
  const startLine = Math.max(0, start.line - 1);
  const endLine = Math.max(0, end.line - 1);
  if (pos.line < startLine || pos.line > endLine) return false;
  if (pos.line === startLine && pos.character < start.column) return false;
  if (pos.line === endLine && pos.character > end.column) return false;
  return true;
}

function toLspRange(range: {
  readonly start: FugaziPosition;
  readonly end: FugaziPosition;
}): LspRange {
  return {
    start: {
      line: Math.max(0, range.start.line - 1),
      character: Math.max(0, range.start.column),
    },
    end: {
      line: Math.max(0, range.end.line - 1),
      character: Math.max(0, range.end.column),
    },
  };
}
