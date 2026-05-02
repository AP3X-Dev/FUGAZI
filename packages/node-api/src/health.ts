/**
 * health.ts — Phase 3h.5 (T201) — programmatic `health()`.
 *
 * Wrapper over `runAnalysis({ kind: 'health-only' })`. The health-only mode
 * dispatches the `complexity-hotspot` and `cognitive-complexity` rules. The
 * result is filtered to that family and surfaced as `issues`.
 *
 * v1 limitation: `score` and `refactorTargets` are typed but always
 * `undefined` in 3h.5. Populating them requires the per-file
 * `FileComplexity` map produced inside `runAnalysis()`, which is not
 * currently exposed on `RunAnalysisResult`. A later phase will widen the
 * driver's public surface (or attach the map to the result) so this wrapper
 * can call `computeFileScore` / `computeProjectScore` /
 * `computeRefactorTargets` directly.
 */

import { runAnalysis } from '@fugazi/core';
import type { DiscriminatedIssue } from '@fugazi/types';
import { loadConfig } from './load-config.js';
import type { HealthOptions, HealthResult } from './types.js';

const HEALTH_KINDS = new Set(['complexity-hotspot', 'cognitive-complexity']);

export async function health(opts: HealthOptions): Promise<HealthResult> {
  const config = opts.config ?? (await loadConfig(opts.projectRoot));
  const result = await runAnalysis({
    kind: 'health-only',
    config,
    projectRoot: opts.projectRoot,
    ...(opts.abortSignal !== undefined ? { abortSignal: opts.abortSignal } : {}),
    ...(opts.coverage !== undefined
      ? {
          coverage: {
            input: opts.coverage,
            ...(opts.coverageRoot !== undefined ? { root: opts.coverageRoot } : {}),
          },
        }
      : {}),
  });

  const filtered: DiscriminatedIssue[] = [];
  for (const issue of result.issues) {
    if (HEALTH_KINDS.has(issue.kind)) filtered.push(issue);
  }

  return Object.freeze({
    issues: Object.freeze(filtered),
    metrics: result.metrics,
    ...(result.runtime !== undefined ? { runtime: result.runtime } : {}),
  }) satisfies HealthResult;
}
