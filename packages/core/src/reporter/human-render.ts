/**
 * reporter/human-render.ts — Phase 3j — shared human-readable renderer used
 * by both `HumanReporter` (TTY/colour) and `HumanPlainReporter` (plain ASCII).
 *
 * The two reporters differ only in whether colour codes are emitted; the
 * section ordering, per-rule grouping, file path display, and footer line are
 * identical. We keep the renderer pure: input is `(issues, events, meta)`, a
 * `Style` adapter, and a clock-substitute (the elapsed-ms metric is taken
 * from the analyze.done event when present, falling back to `0`).
 *
 * No `Date.now()` / `Math.random()` / `process.cwd()` access here.
 */

import type { DiscriminatedIssue } from '@fugazi/types';
import type { ProgressEvent } from '../types.js';
import {
  LF,
  type Section,
  groupBy,
  relPath,
  sectionOf,
  sortIssues,
  startColumn,
  startLine,
} from './common.js';
import type { ReporterMeta } from './types.js';

/**
 * Tiny ANSI styling adapter. The plain renderer passes a no-op identity; the
 * TTY renderer passes `ansiStyle`. Implementing inline avoids a hard chalk
 * dependency (chalk@5 is ESM-only and the interop story on Bun + Node + Vitest
 * is fragile enough to not be worth the bytes).
 */
export interface Style {
  bold(s: string): string;
  cyan(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  yellow(s: string): string;
}

const ESC = '[';
const RESET = `${ESC}0m`;

function wrap(code: string, s: string): string {
  return `${ESC}${code}m${s}${RESET}`;
}

export const ansiStyle: Style = {
  bold: (s) => wrap('1', s),
  cyan: (s) => wrap('36', s),
  dim: (s) => wrap('2', s),
  red: (s) => wrap('31', s),
  yellow: (s) => wrap('33', s),
};

export const plainStyle: Style = {
  bold: (s) => s,
  cyan: (s) => s,
  dim: (s) => s,
  red: (s) => s,
  yellow: (s) => s,
};

/** Map RuleId → human-readable section title. */
const RULE_TITLE: Readonly<Record<DiscriminatedIssue['kind'], string>> = {
  'unused-files': 'unused files',
  'unused-exports': 'unused exports',
  'unused-types': 'unused types',
  'unused-deps': 'unused dependencies',
  'unused-dev-deps': 'unused devDependencies',
  'unused-optional-deps': 'unused optionalDependencies',
  'unused-enum-members': 'unused enum members',
  'unused-class-members': 'unused class members',
  'circular-dependencies': 'circular dependencies',
  'boundary-violations': 'boundary violations',
  'unresolved-imports': 'unresolved imports',
  'unlisted-dependencies': 'unlisted dependencies',
  'duplicate-exports': 'duplicate exports',
  'private-type-leak': 'private type leaks',
  'complexity-hotspot': 'complexity hotspots',
  'cognitive-complexity': 'cognitive complexity',
  'code-duplication': 'code duplication',
  'cold-code': 'cold code',
  'hot-path': 'hot paths',
};

/** Find the most recent elapsed-ms hint in the event stream, if any. */
function elapsedMs(_events: readonly ProgressEvent[]): number {
  // Phase 3j: progress events do not yet carry elapsed time directly. The
  // footer always reports 0 when no elapsed-ms data exists. NFR-1: no clock
  // reads inside the reporter.
  return 0;
}

function distinctFiles(issues: readonly DiscriminatedIssue[]): number {
  const set = new Set<string>();
  for (const i of issues) set.add(i.file);
  return set.size;
}

/**
 * Render a single human-readable report. Pure function over inputs.
 */
export function renderHuman(
  issues: readonly DiscriminatedIssue[],
  events: readonly ProgressEvent[],
  meta: ReporterMeta | undefined,
  style: Style,
): string {
  const sorted = sortIssues(issues);
  const lines: string[] = [];
  const version = meta?.version ?? '0.0.0';
  const mode = meta?.mode ?? 'full';
  const root = meta?.projectRoot;

  lines.push(`${style.bold(`Fugazi v${version}`)} ${style.dim('—')} ${mode} mode`);
  lines.push('');

  if (sorted.length === 0) {
    lines.push(style.dim('No issues found.'));
  } else {
    const bySection = groupBy(sorted, (i) => sectionOf(i.kind));
    const sectionOrder: ReadonlyArray<readonly [Section, string]> = [
      ['dead-code', 'Dead code'],
      ['duplicates', 'Duplicates'],
      ['health', 'Health'],
      ['runtime', 'Runtime'],
    ];

    for (const [key, title] of sectionOrder) {
      const inSection = bySection.get(key);
      if (inSection === undefined || inSection.length === 0) continue;
      lines.push(style.bold(title));
      const byRule = groupBy(inSection, (i) => i.kind);
      for (const [rule, ruleIssues] of byRule) {
        lines.push(`  ${style.cyan(RULE_TITLE[rule])} (${ruleIssues.length})`);
        for (const issue of ruleIssues) {
          const path = relPath(issue.file, root);
          const loc = `${path}:${startLine(issue)}:${startColumn(issue)}`;
          const sev =
            issue.severity === 'error'
              ? style.red('error')
              : issue.severity === 'warn'
                ? style.yellow('warn')
                : style.dim('off');
          lines.push(`    ${loc}  ${sev}  ${issue.message}`);
        }
      }
      lines.push('');
    }
  }

  const fileCount = distinctFiles(sorted);
  const ms = elapsedMs(events);
  const footer = `${sorted.length} issues found across ${fileCount} files in ${ms}ms`;
  lines.push(style.bold(footer));

  return lines.join(LF) + LF;
}
