/**
 * reporter/markdown.ts — Phase 3j — GitHub-flavored Markdown report.
 *
 * LLM-friendly: section headings + tables + no emojis. Suitable for posting
 * as a PR comment, attaching to a CI artifact, or feeding to an MCP-equipped
 * agent for triage.
 *
 * Sections (in order):
 *   # Fugazi Report — <mode>
 *   ## Summary
 *   ## Dead code     (per-rule subheaders, table of file/line/message)
 *   ## Duplicates    (per-rule subheaders, table)
 *   ## Health        (per-rule subheaders, table)
 *   ## Runtime       (when present)
 *   ## Diagnostics by rule  (count table)
 */

import type { DiscriminatedIssue, RuleId } from '@fugazi/types';
import { ReporterBase } from './base.js';
import { LF, groupBy, relPath, sectionOf, sortIssues, startColumn, startLine } from './common.js';
import type { ReporterFormat, ReporterMeta } from './types.js';

const RULE_TITLE: Readonly<Record<RuleId, string>> = {
  'unused-files': 'Unused files',
  'unused-exports': 'Unused exports',
  'unused-types': 'Unused types',
  'unused-deps': 'Unused dependencies',
  'unused-dev-deps': 'Unused devDependencies',
  'unused-optional-deps': 'Unused optionalDependencies',
  'unused-enum-members': 'Unused enum members',
  'unused-class-members': 'Unused class members',
  'circular-dependencies': 'Circular dependencies',
  'boundary-violations': 'Boundary violations',
  'unresolved-imports': 'Unresolved imports',
  'unlisted-dependencies': 'Unlisted dependencies',
  'duplicate-exports': 'Duplicate exports',
  'private-type-leak': 'Private type leaks',
  'complexity-hotspot': 'Complexity hotspots',
  'cognitive-complexity': 'Cognitive complexity',
  'code-duplication': 'Code duplication',
  'cold-code': 'Cold code',
  'hot-path': 'Hot paths',
};

/** Escape pipe characters so they do not break GFM table cells. */
function cell(s: string): string {
  return s.replace(/\|/gu, '\\|');
}

function renderTable(
  rows: ReadonlyArray<readonly [string, string, string]>,
  lines: string[],
): void {
  lines.push('| File | Line | Message |');
  lines.push('| --- | --- | --- |');
  for (const [file, line, msg] of rows) {
    lines.push(`| \`${cell(file)}\` | ${line} | ${cell(msg)} |`);
  }
  lines.push('');
}

function distinctFiles(issues: readonly DiscriminatedIssue[]): number {
  const set = new Set<string>();
  for (const i of issues) set.add(i.file);
  return set.size;
}

function emitSection(
  title: string,
  issues: readonly DiscriminatedIssue[],
  root: string | undefined,
  lines: string[],
): void {
  if (issues.length === 0) return;
  lines.push(`## ${title}`);
  lines.push('');
  const byRule = groupBy(issues, (i) => i.kind);
  for (const [rule, ruleIssues] of byRule) {
    lines.push(`### ${RULE_TITLE[rule]}`);
    lines.push('');
    const rows: Array<readonly [string, string, string]> = [];
    for (const issue of ruleIssues) {
      const path = relPath(issue.file, root);
      rows.push([path, `${startLine(issue)}:${startColumn(issue)}`, issue.message]);
    }
    renderTable(rows, lines);
  }
}

/** `markdown` — GFM report. */
export class MarkdownReporter extends ReporterBase {
  protected override readonly format: ReporterFormat = 'markdown';

  protected override serialize(meta: ReporterMeta | undefined): string {
    const sorted = sortIssues(this.issues);
    const root = meta?.projectRoot;
    const mode = meta?.mode ?? 'full';
    const version = meta?.version ?? '0.0.0';
    const lines: string[] = [];

    lines.push(`# Fugazi Report — ${mode}`);
    lines.push('');
    lines.push(`Tool version: \`${version}\``);
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(`- ${sorted.length} issues across ${distinctFiles(sorted)} files`);
    lines.push('');

    const bySection = groupBy(sorted, (i) => sectionOf(i.kind));
    emitSection('Dead code', bySection.get('dead-code') ?? [], root, lines);
    emitSection('Duplicates', bySection.get('duplicates') ?? [], root, lines);
    emitSection('Health', bySection.get('health') ?? [], root, lines);
    emitSection('Runtime', bySection.get('runtime') ?? [], root, lines);

    // Counts table — always emitted, even when empty, for stable shape.
    lines.push('## Diagnostics by rule');
    lines.push('');
    lines.push('| Rule | Count |');
    lines.push('| --- | --- |');
    const byRule = groupBy(sorted, (i) => i.kind);
    const ruleIds = [...byRule.keys()].sort();
    if (ruleIds.length === 0) {
      lines.push('| _none_ | 0 |');
    } else {
      for (const rule of ruleIds) {
        const count = byRule.get(rule)?.length ?? 0;
        lines.push(`| \`${rule}\` | ${count} |`);
      }
    }
    lines.push('');

    return lines.join(LF);
  }
}
