/**
 * reporter/json.ts — Phase 3j — Fugazi v1 JSON report.
 *
 * Top-level shape (stable key order):
 *   {
 *     "$schema": "https://fugazi.dev/schemas/report-v1.json",
 *     "version": "<tool version>",
 *     "mode": "<analysis mode>",
 *     "issues": [...],
 *     "metrics": { "issueCount": N, "fileCount": N },
 *     "runtime": null,
 *     "_meta": { ... }
 *   }
 *
 * Issue shape:
 *   { ruleId, severity, file, line, col, endLine, endCol, message }
 *
 * Two-space indented, terminating LF. Deterministic across runs (NFR-1).
 */

import type { DiscriminatedIssue } from '@fugazi/types';
import { ReporterBase } from './base.js';
import { endColumn, endLine, relPath, sortIssues, startColumn, startLine } from './common.js';
import type { ReporterFormat, ReporterMeta } from './types.js';

interface JsonIssue {
  readonly ruleId: string;
  readonly severity: string;
  readonly file: string;
  readonly line: number;
  readonly col: number;
  readonly endLine: number;
  readonly endCol: number;
  readonly message: string;
}

function toJsonIssue(issue: DiscriminatedIssue, root: string | undefined): JsonIssue {
  return {
    ruleId: issue.kind,
    severity: issue.severity,
    file: relPath(issue.file, root),
    line: startLine(issue),
    col: startColumn(issue),
    endLine: endLine(issue),
    endCol: endColumn(issue),
    message: issue.message,
  };
}

function distinctFileCount(issues: readonly DiscriminatedIssue[]): number {
  const set = new Set<string>();
  for (const i of issues) set.add(i.file);
  return set.size;
}

/** `json` — structured analysis report. Two-space indent, deterministic. */
export class JsonReporter extends ReporterBase {
  protected override readonly format: ReporterFormat = 'json';

  protected override serialize(meta: ReporterMeta | undefined): string {
    const sorted = sortIssues(this.issues);
    const root = meta?.projectRoot;
    const payload = {
      $schema: 'https://fugazi.dev/schemas/report-v1.json',
      version: meta?.version ?? '0.0.0',
      mode: meta?.mode ?? 'full',
      issues: sorted.map((i) => toJsonIssue(i, root)),
      metrics: {
        issueCount: sorted.length,
        fileCount: distinctFileCount(sorted),
      },
      runtime: null,
      _meta: {
        projectRoot: meta?.projectRoot ?? '',
        determinismHash: meta?.determinismHash ?? null,
        progressEventCount: this.events.length,
      },
    };
    return `${JSON.stringify(payload, null, 2)}\n`;
  }
}
