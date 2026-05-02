/**
 * tools/fix-apply.ts — Phase 3h.4 (T199) — `fix_apply` STUB.
 *
 * The lone MUTATING tool (FR-K5 / IMP-SEC-07). Body lands in Phase 3h.6.
 * Returns a verbatim not-implemented envelope; the wire shape and brand are
 * already in place so the registry's read-only invariant is enforceable
 * today.
 */

import { z } from 'zod';
import { buildMeta, wrapError } from '../meta.js';
import { type MutatingTool, type ToolResult, defineMutatingTool } from '../types.js';

export const FixApplyArgs = z.object({
  projectRoot: z.string().min(1),
  ruleIds: z.array(z.string()).optional(),
  dryRun: z.boolean().optional(),
});

export type FixApplyArgsT = z.infer<typeof FixApplyArgs>;

export interface FixApplyResult {
  readonly stub: true;
}

export const FIX_APPLY_MESSAGE = 'fix_apply: not implemented yet (Phase 3h.6)';

export const fixApplyTool: MutatingTool<FixApplyArgsT, FixApplyResult> = defineMutatingTool({
  name: 'fix_apply',
  description: 'Apply machine-applicable fixes to project source (stub - lands in Phase 3h.6).',
  schema: FixApplyArgs,
  handler: async (): Promise<ToolResult<FixApplyResult>> => {
    return wrapError(FIX_APPLY_MESSAGE, buildMeta([]));
  },
});
