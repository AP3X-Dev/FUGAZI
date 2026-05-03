/**
 * cross-ref.ts — Phase 3f.6 (T166) — file-level finding short-circuit.
 *
 * Per §4.B.5: when `unused-files` flags a file, every per-export finding on
 * that same file is redundant — the parent file is already known dead, so the
 * exports it carries are dead by transitivity. This filter trims those
 * downstream findings before sort + emit.
 *
 * The filter runs O(N) over the issue list:
 *   1. Collect the set of paths flagged `unused-files` into a `Set<string>`.
 *   2. Walk the issue list once; drop any `unused-exports` / `unused-types` /
 *      `unused-enum-members` / `unused-class-members` whose `file` is in that
 *      set. Other rule kinds pass through.
 *
 * Synchronous. Pure. Never throws. Input is not mutated.
 */

import { matchesGlob } from '@fugazi/plugins';
import type { DiscriminatedIssue, RuleId } from '@fugazi/types';

/**
 * Plugin-driven cross-reference filters (Phase 3i Wave B). Pass-through
 * `undefined` when no plugin contributed any rules, so existing call sites
 * that don't pass plugins are unchanged.
 *
 *   - `alwaysUsedPatterns` — globs (project-relative POSIX) that suppress
 *     unused-files findings on matching paths. The matching path is also
 *     short-circuited just like an actual unused-files finding would be.
 *   - `usedExportRules` — per-file allowlists. An unused-exports finding
 *     whose file matches `pattern` AND whose exportName is in `exports` is
 *     filtered.
 *   - `toolingDependencies` — package names that should never surface as
 *     unused-deps / unused-dev-deps / unused-optional-deps.
 *   - `usedClassMemberNames` — class-member names that should never surface
 *     as unused-class-members. Flat strings only; scoped rules with
 *     extends/implements heritage filters are deferred to a later phase.
 *   - `projectRootPosix` — used to make finding paths project-relative
 *     before glob matching.
 */
export interface PluginCrossRefFilters {
  readonly alwaysUsedPatterns: readonly string[];
  readonly usedExportRules: readonly {
    readonly pattern: string;
    readonly exports: readonly string[];
  }[];
  readonly toolingDependencies: ReadonlySet<string>;
  readonly usedClassMemberNames: ReadonlySet<string>;
  readonly projectRootPosix: string;
}

/**
 * Rule kinds that are short-circuited by an `unused-files` finding on the
 * same path. The list is closed; adding a kind here is a deliberate change
 * to the cross-reference contract.
 */
const SHORT_CIRCUITED: ReadonlySet<RuleId> = new Set<RuleId>([
  'unused-exports',
  'unused-types',
  'unused-enum-members',
  'unused-class-members',
]);

export interface CrossReferenceResult {
  /** The filtered issue list — same order as input minus suppressed entries. */
  readonly issues: readonly DiscriminatedIssue[];
  /** The set of paths that triggered short-circuiting (for observability). */
  readonly shortCircuitedPaths: ReadonlySet<string>;
  /** Count of issues filtered out, partitioned by RuleId. */
  readonly filteredByRule: Readonly<Partial<Record<RuleId, number>>>;
}

/**
 * Apply the `§4.B.5` cross-reference filter + Phase 3i Wave B plugin
 * filters to a sorted issue list. The walk is two-pass:
 *   1. Drop any unused-files finding whose path is matched by a plugin's
 *      `alwaysUsed` glob — those files are framework-known to be live.
 *   2. Collect remaining unused-files orphan paths.
 *   3. Walk all issues once, suppressing:
 *      - per-export findings on orphan files (existing 3f.6 contract)
 *      - per-export findings whose (path, name) is in a plugin's usedExports
 *      - unused-deps / unused-dev-deps / unused-optional-deps for any
 *        dependency in the plugin tooling allowlist
 *      - unused-class-members whose memberName is in the plugin allowlist
 *
 * `filters` is optional — when undefined, only the §4.B.5 rule applies and
 * existing behaviour is unchanged.
 */
export function applyCrossReferenceFilter(
  issues: readonly DiscriminatedIssue[],
  filters?: PluginCrossRefFilters,
): CrossReferenceResult {
  const projectRoot =
    filters !== undefined && filters.projectRootPosix.length > 0
      ? filters.projectRootPosix.endsWith('/')
        ? filters.projectRootPosix
        : `${filters.projectRootPosix}/`
      : '';

  const relativize = (path: string): string =>
    projectRoot.length > 0 && path.startsWith(projectRoot) ? path.slice(projectRoot.length) : path;

  // ── Pass 1: collect orphan paths AFTER plugin alwaysUsed filtering ──
  const orphanPaths = new Set<string>();
  const pluginSuppressedPaths = new Set<string>();
  for (const issue of issues) {
    if (issue.kind !== 'unused-files') continue;
    if (filters !== undefined && filters.alwaysUsedPatterns.length > 0) {
      const rel = relativize(issue.file);
      let suppressed = false;
      for (const pattern of filters.alwaysUsedPatterns) {
        if (matchesGlob(pattern, rel)) {
          suppressed = true;
          break;
        }
      }
      if (suppressed) {
        pluginSuppressedPaths.add(issue.file);
        continue;
      }
    }
    orphanPaths.add(issue.file);
  }

  const noWork =
    orphanPaths.size === 0 &&
    pluginSuppressedPaths.size === 0 &&
    (filters === undefined ||
      (filters.usedExportRules.length === 0 &&
        filters.toolingDependencies.size === 0 &&
        filters.usedClassMemberNames.size === 0));
  if (noWork) {
    return {
      issues,
      shortCircuitedPaths: orphanPaths,
      filteredByRule: Object.freeze({}),
    };
  }

  // ── Pass 2: filter ──
  const kept: DiscriminatedIssue[] = [];
  const filtered: Partial<Record<RuleId, number>> = {};
  const bump = (kind: RuleId): void => {
    filtered[kind] = (filtered[kind] ?? 0) + 1;
  };

  for (const issue of issues) {
    // Drop unused-files findings overridden by a plugin's alwaysUsed.
    if (issue.kind === 'unused-files' && pluginSuppressedPaths.has(issue.file)) {
      bump(issue.kind);
      continue;
    }
    // §4.B.5 short-circuit on orphan files.
    if (SHORT_CIRCUITED.has(issue.kind) && orphanPaths.has(issue.file)) {
      bump(issue.kind);
      continue;
    }
    if (filters !== undefined) {
      // Tooling-deps allowlist for unused-deps / unused-dev-deps / unused-optional-deps.
      if (
        (issue.kind === 'unused-deps' ||
          issue.kind === 'unused-dev-deps' ||
          issue.kind === 'unused-optional-deps') &&
        filters.toolingDependencies.has(issue.dependency)
      ) {
        bump(issue.kind);
        continue;
      }
      // usedExports allowlist for unused-exports.
      if (issue.kind === 'unused-exports' && filters.usedExportRules.length > 0) {
        const rel = relativize(issue.file);
        let allowed = false;
        for (const rule of filters.usedExportRules) {
          if (!matchesGlob(rule.pattern, rel)) continue;
          if (rule.exports.includes(issue.exportName)) {
            allowed = true;
            break;
          }
        }
        if (allowed) {
          bump(issue.kind);
          continue;
        }
      }
      // usedClassMembers allowlist (flat names only).
      if (
        issue.kind === 'unused-class-members' &&
        filters.usedClassMemberNames.size > 0 &&
        filters.usedClassMemberNames.has(issue.memberName)
      ) {
        bump(issue.kind);
        continue;
      }
    }
    kept.push(issue);
  }

  return {
    issues: kept,
    shortCircuitedPaths: orphanPaths,
    filteredByRule: Object.freeze(filtered),
  };
}
