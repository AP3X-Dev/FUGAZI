/**
 * analyze.ts — Phase 3h.5 (T201) — programmatic `analyze()` entry point.
 *
 * Thin wrapper over `runAnalysis()` from `@fugazi/core`. Per IMP-API-02 the
 * dead-code helpers (`detect_dead_code`, `detect_unused_files`,
 * `detect_unused_exports`) collapse into this single function with a
 * discriminated `rules` option:
 *
 *   - `rules: 'all'` (or omitted) — dispatch every enabled rule.
 *   - `rules: ['unused-files', ...]` — only the listed RuleIds fire; every
 *     other rule is forced to `'off'` via a config-override merged on top of
 *     the loaded config.
 *
 * Determinism (NFR-1 / SC-26): no global mutable state. Each call constructs
 * a fresh override table, leaves the user's config untouched, and forwards
 * directly to `runAnalysis()`. Two concurrent calls with identical inputs
 * produce byte-identical `_meta.determinismHash` values.
 */

import type { FugaziConfig } from '@fugazi/config';
import { runAnalysis } from '@fugazi/core';
import type { RuleId, Severity } from '@fugazi/types';
import { loadConfig } from './load-config.js';
import type { AnalyzeOptions, AnalyzeResult } from './types.js';

/** Every RuleId currently dispatched by the registry — kept in lock-step. */
const ALL_RULE_IDS: readonly RuleId[] = [
  'boundary-violations',
  'circular-dependencies',
  'code-duplication',
  'cognitive-complexity',
  'complexity-hotspot',
  'duplicate-exports',
  'private-type-leak',
  'unlisted-dependencies',
  'unresolved-imports',
  'unused-class-members',
  'unused-deps',
  'unused-dev-deps',
  'unused-enum-members',
  'unused-exports',
  'unused-files',
  'unused-optional-deps',
  'unused-types',
];

/**
 * Build a per-rule severity override that turns every RuleId not in `keep`
 * to `'off'`. Listed RuleIds are left absent so they pick up the user's
 * configured severity (defaulting to `'error'` per `severityFor`).
 */
function buildRuleOverride(keep: readonly RuleId[]): Readonly<Partial<Record<RuleId, Severity>>> {
  const table: Partial<Record<RuleId, Severity>> = {};
  const keepSet = new Set<RuleId>(keep);
  for (const id of ALL_RULE_IDS) {
    if (!keepSet.has(id)) table[id] = 'off';
  }
  return Object.freeze(table);
}

/** Apply a per-rule override on top of the config. Frozen output. */
function withRuleOverride(
  config: FugaziConfig,
  override: Readonly<Partial<Record<RuleId, Severity>>> | undefined,
): FugaziConfig {
  if (override === undefined) return config;
  return Object.freeze({
    ...config,
    rules: { ...config.rules, ...override },
  });
}

/**
 * Run a Fugazi analysis and return the discriminated issue stream plus
 * metrics. The driver runs the full pipeline (discover → extract → graph →
 * analyze → crossref → optional runtime). Coverage triggers the runtime
 * intelligence layer.
 */
export async function analyze(opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const baseConfig = opts.config ?? (await loadConfig(opts.projectRoot));
  const override =
    opts.rules === undefined || opts.rules === 'all' ? undefined : buildRuleOverride(opts.rules);
  const config = withRuleOverride(baseConfig, override);

  const result = await runAnalysis({
    kind: 'full',
    config,
    projectRoot: opts.projectRoot,
    ...(opts.abortSignal !== undefined ? { abortSignal: opts.abortSignal } : {}),
    ...(opts.onProgress !== undefined ? { onProgress: opts.onProgress } : {}),
    ...(opts.coverage !== undefined
      ? {
          coverage: {
            input: opts.coverage,
            ...(opts.coverageRoot !== undefined ? { root: opts.coverageRoot } : {}),
          },
        }
      : {}),
  });

  return Object.freeze({
    issues: result.issues,
    metrics: result.metrics,
    ...(result.runtime !== undefined ? { runtime: result.runtime } : {}),
    _meta: Object.freeze({
      version: result._meta.version,
      determinismHash: result._meta.determinismHash,
    }),
  }) satisfies AnalyzeResult;
}
