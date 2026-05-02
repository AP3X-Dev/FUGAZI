/**
 * rules/registry.ts — Phase 3f.2 Wave 1 — registry + mode-aware dispatch.
 *
 * `RULES` is the central registry mapping every `RuleId` Fugazi can dispatch
 * to a factory that produces a `RuleHandler` bound to the configured
 * severity. Wave 1 lights up the three reachability rules (unused-files,
 * unused-exports, unused-types). The remaining 10 dead-code rules ship in
 * Wave 2; duplicates / health / runtime-intelligence rules in 3f.4 / 3f.5.
 *
 * `runEnabledRules(ctx, mode, config)` is the deterministic dispatcher used
 * by `runAnalysis()`:
 *
 *   - Iterates registered RuleIds in stable alphabetical order so the
 *     determinism hash is invariant under registry-insertion changes.
 *   - Filters by mode:
 *       audit          — read-only; emits zero diagnostics regardless of
 *                        which rules are registered.
 *       dead-code-only — runs only the 13 dead-code-family rules.
 *       dupes-only     — runs the duplicates family (none in Wave 1, so
 *                        currently a no-op).
 *       health-only    — runs the health family (none in Wave 1).
 *       full           — runs every registered rule (subject to severity).
 *   - Filters by per-rule severity from `config.rules`. A rule whose
 *     configured severity is `'off'` MUST NOT be invoked. Default severity
 *     when the rule is absent from config is `'error'`.
 *
 * The dispatcher returns the unioned issue array sorted by
 * `(file, range.start.byteOffset, kind)` so callers receive a fully ordered
 * stream (NFR-1 / SC-15).
 */

import type { FugaziConfig } from '@fugazi/config';
import type { DiscriminatedIssue, Range, RuleId, Severity } from '@fugazi/types';
import type { AnalysisMode } from '../types.js';
import { createBoundaryViolationsRule } from './boundaries.js';
import { createCircularDependenciesRule } from './circular-deps.js';
import { createCodeDuplicationRule } from './code-duplication.js';
import {
  createDuplicateExportsRule,
  createUnlistedDependenciesRule,
  createUnresolvedImportsRule,
} from './import-hygiene.js';
import { createPrivateTypeLeakRule } from './private-type-leak.js';
import type { RuleContext, RuleHandler } from './types.js';
import {
  createUnusedDepsRule,
  createUnusedDevDepsRule,
  createUnusedOptionalDepsRule,
} from './unused-deps.js';
import { createUnusedExportsRule } from './unused-exports.js';
import { createUnusedFilesRule } from './unused-files.js';
import { createUnusedClassMembersRule, createUnusedEnumMembersRule } from './unused-members.js';
import { createUnusedTypesRule } from './unused-types.js';

/**
 * Dead-code-family RuleIds — the 14-rule surface dispatched in 'dead-code-only'.
 * Includes structural-correctness rules (`boundary-violations`) alongside the
 * pure dead-code rules; together they form the read-and-write fast path that
 * `dead-code-only` mode targets.
 */
export const DEAD_CODE_RULES = new Set<RuleId>([
  'unused-files',
  'unused-exports',
  'unused-types',
  'unused-deps',
  'unused-dev-deps',
  'unused-optional-deps',
  'unused-enum-members',
  'unused-class-members',
  'circular-dependencies',
  'boundary-violations',
  'unresolved-imports',
  'unlisted-dependencies',
  'duplicate-exports',
  'private-type-leak',
]);

/** Duplicates-family RuleIds — dispatched in 'dupes-only' (3f.4). */
export const DUPES_RULES = new Set<RuleId>(['code-duplication']);

/** Health-family RuleIds — dispatched in 'health-only' (3f.5). */
export const HEALTH_RULES = new Set<RuleId>(['complexity-hotspot', 'cognitive-complexity']);

/**
 * Factory signature stored in the registry. Each entry pulls the resolved
 * severity at dispatch time so the handler closure carries the user's config
 * decision.
 */
export type RuleFactory = (severity: Severity) => RuleHandler;

/**
 * `RULES` — the canonical registry. Entries are added in alphabetical order
 * for review-friendly diffs; iteration order during dispatch is enforced by
 * `runEnabledRules` via an explicit `.sort()` so insertion order is not
 * load-bearing.
 */
export const RULES: ReadonlyMap<RuleId, RuleFactory> = new Map<RuleId, RuleFactory>([
  ['boundary-violations', createBoundaryViolationsRule],
  ['circular-dependencies', createCircularDependenciesRule],
  ['code-duplication', createCodeDuplicationRule],
  ['duplicate-exports', createDuplicateExportsRule],
  ['private-type-leak', createPrivateTypeLeakRule],
  ['unlisted-dependencies', createUnlistedDependenciesRule],
  ['unresolved-imports', createUnresolvedImportsRule],
  ['unused-class-members', createUnusedClassMembersRule],
  ['unused-deps', createUnusedDepsRule],
  ['unused-dev-deps', createUnusedDevDepsRule],
  ['unused-enum-members', createUnusedEnumMembersRule],
  ['unused-exports', createUnusedExportsRule],
  ['unused-files', createUnusedFilesRule],
  ['unused-optional-deps', createUnusedOptionalDepsRule],
  ['unused-types', createUnusedTypesRule],
]);

/**
 * Resolve the configured severity for a rule. Defaults to 'error' when the
 * rule is absent from config.rules (per design-doc §3.4 / FR-A1).
 */
export function severityFor(ruleId: RuleId, config: FugaziConfig): Severity {
  const override = config.rules?.[ruleId];
  return override ?? 'error';
}

/** Decide whether a rule should fire under the given mode. */
function modeIncludes(mode: AnalysisMode, ruleId: RuleId): boolean {
  switch (mode) {
    case 'audit':
      return false;
    case 'full':
      return true;
    case 'dead-code-only':
      return DEAD_CODE_RULES.has(ruleId);
    case 'dupes-only':
      return DUPES_RULES.has(ruleId);
    case 'health-only':
      return HEALTH_RULES.has(ruleId);
  }
}

/**
 * Result wrapper exposed for callers (e.g. `runAnalysis`) that want to wire
 * progress events with per-rule granularity. The `enabledRules` array is the
 * deterministically-sorted RuleId list the dispatcher walks; callers can use
 * its length as the total in `analyze.start`/`analyze.progress` events.
 */
export interface RunEnabledRulesResult {
  readonly issues: readonly DiscriminatedIssue[];
  readonly enabledRules: readonly RuleId[];
  readonly diagnosticsByRule: Readonly<Partial<Record<RuleId, number>>>;
}

/**
 * Compute the deterministically-sorted list of RuleIds that should fire under
 * `mode` and `config`. Exposed so callers can emit `analyze.start` with the
 * exact rule count before dispatch begins.
 */
export function listEnabledRules(mode: AnalysisMode, config: FugaziConfig): readonly RuleId[] {
  const enabled: RuleId[] = [];
  for (const ruleId of RULES.keys()) {
    if (!modeIncludes(mode, ruleId)) continue;
    if (severityFor(ruleId, config) === 'off') continue;
    enabled.push(ruleId);
  }
  return enabled.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Dispatch every enabled rule and return the sorted union of their findings.
 *
 *   - `onRuleStart`  optional hook fired BEFORE each rule runs. Receives the
 *                    1-based rule index and total enabled count for progress
 *                    emission. Throws are propagated; callers wrap their own
 *                    error handling.
 */
export function runEnabledRules(
  ctx: RuleContext,
  mode: AnalysisMode,
  config: FugaziConfig,
  onRuleStart?: (ruleId: RuleId, n: number, total: number) => void,
): RunEnabledRulesResult {
  const enabled = listEnabledRules(mode, config);
  const allIssues: DiscriminatedIssue[] = [];
  const counts: Partial<Record<RuleId, number>> = {};

  for (let i = 0; i < enabled.length; i++) {
    const ruleId = enabled[i];
    if (ruleId === undefined) continue;
    const factory = RULES.get(ruleId);
    if (factory === undefined) continue;

    onRuleStart?.(ruleId, i + 1, enabled.length);

    const handler = factory(severityFor(ruleId, config));
    const issues = handler(ctx);
    counts[ruleId] = issues.length;
    for (const issue of issues) allIssues.push(issue);
  }

  const sorted = [...allIssues].sort(compareIssues);
  return Object.freeze({
    issues: sorted,
    enabledRules: enabled,
    diagnosticsByRule: Object.freeze(counts),
  });
}

/* -------------------------------------------------------------------------- */
/* Determinism helpers                                                         */
/* -------------------------------------------------------------------------- */

function compareIssues(a: DiscriminatedIssue, b: DiscriminatedIssue): number {
  if (a.file < b.file) return -1;
  if (a.file > b.file) return 1;
  const aOff = byteOffsetOf(a.range);
  const bOff = byteOffsetOf(b.range);
  if (aOff !== bOff) return aOff - bOff;
  if (a.kind < b.kind) return -1;
  if (a.kind > b.kind) return 1;
  return 0;
}

function byteOffsetOf(range: Range | undefined): number {
  return range !== undefined ? range.start.byteOffset : -1;
}
