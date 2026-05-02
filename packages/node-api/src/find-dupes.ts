/**
 * find-dupes.ts — Phase 3h.5 (T201) — programmatic `findDupes()`.
 *
 * Wrapper over `runAnalysis({ kind: 'dupes-only' })`. The dupes-only mode
 * dispatches only the `code-duplication` rule. The result is filtered to that
 * variant and exposed as `cloneFamilies`.
 *
 * v1 limitation: `opts.minTokens` is accepted on the surface but the
 * underlying rule sources its threshold from `FugaziConfig`/rule defaults. The
 * knob is a no-op in 3h.5; wiring lands when the dupes rule exposes a public
 * threshold field.
 */

import { runAnalysis } from '@fugazi/core';
import type { CodeDuplicationIssue } from '@fugazi/types';
import { loadConfig } from './load-config.js';
import type { DupesResult, FindDupesOptions } from './types.js';

export async function findDupes(opts: FindDupesOptions): Promise<DupesResult> {
  const config = opts.config ?? (await loadConfig(opts.projectRoot));
  const result = await runAnalysis({
    kind: 'dupes-only',
    config,
    projectRoot: opts.projectRoot,
    ...(opts.abortSignal !== undefined ? { abortSignal: opts.abortSignal } : {}),
  });

  const families: CodeDuplicationIssue[] = [];
  for (const issue of result.issues) {
    if (issue.kind === 'code-duplication') families.push(issue);
  }
  return Object.freeze({
    cloneFamilies: Object.freeze(families),
    metrics: result.metrics,
  }) satisfies DupesResult;
}
