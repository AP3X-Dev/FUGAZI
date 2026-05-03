/**
 * tools/fix-apply.ts — Phase 3h.6 (T211-T213) — `fix_apply` MutatingTool.
 *
 * The lone MUTATING tool (FR-K5 / IMP-SEC-07). Drives the same fix engine
 * the CLI uses; mutates files on disk via per-file atomic writes (.tmp.<rand>
 * + rename). When `dryRun: true` the tool returns the plan without writing.
 *
 * Result envelope is the standard `_meta`-wrapped shape; `data.outcomes`
 * carries per-file status and `data.plan` carries the would-be edits.
 */

import { type FileFixOutcome, type PlannedFileFix, applyFixes, runAnalysis } from '@fugazi/core';
import type { RuleId } from '@fugazi/types';
import { z } from 'zod';
import { runWithMeta } from '../common.js';
import { type MutatingTool, type ToolResult, defineMutatingTool } from '../types.js';
import { loadConfigForRoot } from './_shared.js';

export const FixApplyArgs = z.object({
  projectRoot: z.string().min(1),
  ruleIds: z.array(z.string()).optional(),
  dryRun: z.boolean().optional(),
});

export type FixApplyArgsT = z.infer<typeof FixApplyArgs>;

export interface FixApplyResult {
  readonly applied: number;
  readonly skipped: number;
  readonly errors: number;
  readonly outcomes: readonly FileFixOutcome[];
  readonly plan: readonly PlannedFileFix[];
  readonly dryRun: boolean;
}

export const fixApplyTool: MutatingTool<FixApplyArgsT, FixApplyResult> = defineMutatingTool({
  name: 'fix_apply',
  description: 'Apply machine-applicable fixes to project source.',
  schema: FixApplyArgs,
  handler: async (input): Promise<ToolResult<FixApplyResult>> => {
    return runWithMeta<FixApplyResult>(async (record) => {
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
        dryRun: input.dryRun === true,
      });
      return {
        applied: fix.applied,
        skipped: fix.skipped,
        errors: fix.errors,
        outcomes: fix.outcomes,
        plan: fix.plan,
        dryRun: fix.dryRun,
      } satisfies FixApplyResult;
    });
  },
});
