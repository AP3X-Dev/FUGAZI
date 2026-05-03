/**
 * tools/fix-dry-run.ts — Phase 3h.6 (T211-T213) — `fix_dry_run` ReadOnlyTool.
 *
 * Read-only preview of would-be edits. Drives the same fix engine as
 * `fix_apply` with `dryRun: true`, so the planned per-file edit batches are
 * computed identically — but no disk mutation occurs.
 */

import { type PlannedFileFix, applyFixes, runAnalysis } from '@fugazi/core';
import type { RuleId } from '@fugazi/types';
import { z } from 'zod';
import { runWithMeta } from '../common.js';
import { type ReadOnlyTool, type ToolResult, defineReadOnlyTool } from '../types.js';
import { loadConfigForRoot } from './_shared.js';

export const FixDryRunArgs = z.object({
  projectRoot: z.string().min(1),
  ruleIds: z.array(z.string()).optional(),
});

export type FixDryRunArgsT = z.infer<typeof FixDryRunArgs>;

export interface FixDryRunResult {
  readonly plan: readonly PlannedFileFix[];
  readonly fileCount: number;
}

export const fixDryRunTool: ReadOnlyTool<FixDryRunArgsT, FixDryRunResult> = defineReadOnlyTool({
  name: 'fix_dry_run',
  description: 'Preview machine-applicable fixes without writing to disk.',
  schema: FixDryRunArgs,
  handler: async (input): Promise<ToolResult<FixDryRunResult>> => {
    return runWithMeta<FixDryRunResult>(async (record) => {
      const cfg = await loadConfigForRoot(input.projectRoot);
      const result = await runAnalysis({
        kind: 'full',
        config: cfg,
        projectRoot: input.projectRoot,
        onProgress: record,
      });
      const filter = (input.ruleIds ?? []) as readonly RuleId[];
      const fix = await applyFixes({
        actions: result.actions,
        ...(filter.length > 0 ? { ruleFilter: filter } : {}),
        dryRun: true,
      });
      return {
        plan: fix.plan,
        fileCount: fix.plan.length,
      } satisfies FixDryRunResult;
    });
  },
});
