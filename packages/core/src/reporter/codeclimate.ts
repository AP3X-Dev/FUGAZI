/**
 * reporter/codeclimate.ts — Phase 3j — GitLab Code Climate JSON report.
 *
 * Pretty-printed JSON array (Fallow precedent: `serde_json::to_string_pretty`).
 * Each element is a Code Climate issue object with a deterministic
 * sha1-based fingerprint over `(ruleId, path, line, message)`.
 *
 * Categories per rule kind:
 *   - duplicates / duplicate-exports → "Duplication"
 *   - complexity-hotspot / cognitive-complexity → "Complexity"
 *   - boundary-violations → "Style"
 *   - everything else → "Bug Risk"
 *
 * Severity ladder: error → "major", warn → "minor", off → "info".
 */

import type { DiscriminatedIssue } from '@fugazi/types';
import { ReporterBase } from './base.js';
import {
  ccCategory,
  ccSeverity,
  endLine,
  relPath,
  sha1Hex,
  sortIssues,
  startLine,
} from './common.js';
import type { ReporterFormat, ReporterMeta } from './types.js';

interface CcIssue {
  readonly type: 'issue';
  readonly check_name: string;
  readonly description: string;
  readonly categories: readonly string[];
  readonly severity: 'major' | 'minor' | 'info';
  readonly fingerprint: string;
  readonly location: {
    readonly path: string;
    readonly lines: { readonly begin: number; readonly end: number };
  };
}

function buildIssue(issue: DiscriminatedIssue, root: string | undefined): CcIssue {
  const path = relPath(issue.file, root);
  const begin = startLine(issue);
  const end = endLine(issue);
  const fp = sha1Hex(`${issue.kind}:${path}:${begin}:${issue.message}`);
  return {
    type: 'issue',
    check_name: issue.kind,
    description: issue.message,
    categories: [ccCategory(issue.kind)],
    severity: ccSeverity(issue.severity),
    fingerprint: fp,
    location: {
      path,
      lines: { begin, end },
    },
  };
}

/** `codeclimate` — Code Climate JSON used by GitLab CI quality reports. */
export class CodeclimateReporter extends ReporterBase {
  protected override readonly format: ReporterFormat = 'codeclimate';

  protected override serialize(meta: ReporterMeta | undefined): string {
    const sorted = sortIssues(this.issues);
    const root = meta?.projectRoot;
    const out: CcIssue[] = sorted.map((i) => buildIssue(i, root));
    return `${JSON.stringify(out, null, 2)}\n`;
  }
}
