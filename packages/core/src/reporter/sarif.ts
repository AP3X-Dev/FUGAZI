/**
 * reporter/sarif.ts — Phase 3j — SARIF 2.1.0 report.
 *
 * Used by GitHub code-scanning and other SARIF consumers. Emits a single
 * `runs[0]` entry whose `tool.driver.rules` enumerates every rule that has at
 * least one finding, and whose `results` lists every issue with a 1-indexed
 * `physicalLocation.region`.
 *
 * Two-space indented JSON, terminating LF. Deterministic (NFR-1).
 */

import type { DiscriminatedIssue, RuleId } from '@fugazi/types';
import { ReporterBase } from './base.js';
import {
  endColumn,
  endLine,
  relPath,
  sarifLevel,
  sortIssues,
  startColumn,
  startLine,
} from './common.js';
import type { ReporterFormat, ReporterMeta } from './types.js';

interface SarifResult {
  readonly ruleId: string;
  readonly level: 'error' | 'warning' | 'note';
  readonly message: { readonly text: string };
  readonly locations: ReadonlyArray<{
    readonly physicalLocation: {
      readonly artifactLocation: { readonly uri: string };
      readonly region: {
        readonly startLine: number;
        readonly startColumn: number;
        readonly endLine: number;
        readonly endColumn: number;
      };
    };
  }>;
}

interface SarifRule {
  readonly id: string;
  readonly shortDescription: { readonly text: string };
  readonly helpUri: string;
}

const RULE_SHORT: Readonly<Record<RuleId, string>> = {
  'unused-files': 'File is never imported by any other module',
  'unused-exports': 'Exported symbol has no consumers',
  'unused-types': 'Exported type has no consumers',
  'unused-deps': 'Dependency is declared but never imported',
  'unused-dev-deps': 'Dev dependency is declared but never imported',
  'unused-optional-deps': 'Optional dependency is declared but never imported',
  'unused-enum-members': 'Enum member is never referenced',
  'unused-class-members': 'Class member is never referenced',
  'circular-dependencies': 'Closed import cycle detected',
  'boundary-violations': 'Import crosses an architectural boundary',
  'unresolved-imports': 'Import specifier resolves to nothing',
  'unlisted-dependencies': 'Imported package is not declared in package.json',
  'duplicate-exports': 'Same exported name emitted from multiple modules',
  'private-type-leak': 'Non-exported type leaks into a public signature',
  'complexity-hotspot': 'Function exceeds the configured complexity threshold',
  'cognitive-complexity': 'Function exceeds the cognitive-complexity threshold',
  'code-duplication': 'Duplicated code detected across multiple locations',
  'cold-code': 'Function is never executed in any sampled run',
  'hot-path': 'Function executed at or above the hot-path threshold',
};

function buildResult(issue: DiscriminatedIssue, root: string | undefined): SarifResult {
  return {
    ruleId: issue.kind,
    level: sarifLevel(issue.severity),
    message: { text: issue.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: relPath(issue.file, root) },
          region: {
            startLine: startLine(issue),
            startColumn: startColumn(issue),
            endLine: endLine(issue),
            endColumn: endColumn(issue),
          },
        },
      },
    ],
  };
}

function distinctRules(issues: readonly DiscriminatedIssue[]): RuleId[] {
  const seen = new Set<RuleId>();
  const order: RuleId[] = [];
  for (const i of issues) {
    if (!seen.has(i.kind)) {
      seen.add(i.kind);
      order.push(i.kind);
    }
  }
  order.sort();
  return order;
}

/** `sarif` — SARIF 2.1.0 report for GitHub code scanning. */
export class SarifReporter extends ReporterBase {
  protected override readonly format: ReporterFormat = 'sarif';

  protected override serialize(meta: ReporterMeta | undefined): string {
    const sorted = sortIssues(this.issues);
    const root = meta?.projectRoot;
    const rules: SarifRule[] = distinctRules(sorted).map((id) => ({
      id,
      shortDescription: { text: RULE_SHORT[id] },
      helpUri: `https://fugazi.dev/rules/${id}`,
    }));
    const payload = {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'fugazi',
              version: meta?.version ?? '0.0.0',
              informationUri: 'https://fugazi.dev',
              rules,
            },
          },
          results: sorted.map((i) => buildResult(i, root)),
        },
      ],
    };
    return `${JSON.stringify(payload, null, 2)}\n`;
  }
}
