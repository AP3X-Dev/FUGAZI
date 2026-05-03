/**
 * reporter/compact.ts — Phase 3j — one-line-per-issue reporter.
 *
 * Output shape:
 *   `<file>:<line>:<col>:<severity>:<rule-id>:<message>`
 *
 * Severities are `error` / `warning` / `note` per the LSP convention. Lines
 * are LF-terminated. No header, no footer — suitable for `grep`, `awk`, and
 * editor jump-to-line.
 */

import { ReporterBase } from './base.js';
import { LF, relPath, severityWire, sortIssues, startColumn, startLine } from './common.js';
import type { ReporterFormat, ReporterMeta } from './types.js';

/** `compact` — one issue per line, no header/footer. */
export class CompactReporter extends ReporterBase {
  protected override readonly format: ReporterFormat = 'compact';

  protected override serialize(meta: ReporterMeta | undefined): string {
    const sorted = sortIssues(this.issues);
    if (sorted.length === 0) return '';
    const root = meta?.projectRoot;
    const lines = sorted.map((issue) => {
      const path = relPath(issue.file, root);
      const sev = severityWire(issue.severity);
      return `${path}:${startLine(issue)}:${startColumn(issue)}:${sev}:${issue.kind}:${issue.message}`;
    });
    return lines.join(LF) + LF;
  }
}
