/**
 * audit.ts — Phase 3h.5 (T201) — programmatic `audit()`.
 *
 * Wrapper over `runAnalysis({ kind: 'audit' })`. Audit mode walks discover +
 * extract + graph but emits zero diagnostics; we expose the resulting
 * inventory metadata (file count, edge count) so callers can introspect the
 * graph shape without paying for rule dispatch.
 *
 * The graph itself is not surfaced — the driver does not return it on
 * `RunAnalysisResult`. Inventory counts are derived from
 * `metrics.filesScanned` and the graph-edge progress event the driver emits
 * after the build phase.
 */

import { type ProgressEvent, runAnalysis } from '@fugazi/core';
import { loadConfig } from './load-config.js';
import type { AuditOptions, AuditResult } from './types.js';

export async function audit(opts: AuditOptions): Promise<AuditResult> {
  const config = opts.config ?? (await loadConfig(opts.projectRoot));

  let edgeCount = 0;
  const captureEdges = (event: ProgressEvent): void => {
    if (event.kind === 'graph.done') edgeCount = event.edgeCount;
  };

  const result = await runAnalysis({
    kind: 'audit',
    config,
    projectRoot: opts.projectRoot,
    onProgress: captureEdges,
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

  return Object.freeze({
    issues: result.issues,
    inventory: Object.freeze({
      fileCount: result.metrics.filesScanned,
      edgeCount,
    }),
    metrics: result.metrics,
    ...(result.runtime !== undefined ? { runtime: result.runtime } : {}),
  }) satisfies AuditResult;
}
