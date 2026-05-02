/**
 * tools/fix-dry-run.ts — Phase 3h.4 (T199) — `fix_dry_run` STUB.
 *
 * Read-only at v1: the actual edits aren't computed yet (the fix engine
 * lands in Phase 3h.6). Returns an empty edit list with a v1-limitation
 * marker so callers can wire the surface up today and adopt the real edits
 * when 3h.6 ships.
 */

import { z } from 'zod';
import { buildMeta, wrapResult } from '../meta.js';
import { type ReadOnlyTool, type ToolResult, defineReadOnlyTool } from '../types.js';

export const FixDryRunArgs = z.object({
  projectRoot: z.string().min(1),
  ruleIds: z.array(z.string()).optional(),
});

export type FixDryRunArgsT = z.infer<typeof FixDryRunArgs>;

export interface FixDryRunEdit {
  readonly file: string;
  readonly description: string;
}

export interface FixDryRunResult {
  readonly edits: readonly FixDryRunEdit[];
  /** Verbatim marker explaining the v1 limitation. */
  readonly note: 'fix_dry_run: edit computation lands in Phase 3h.6';
}

export const fixDryRunTool: ReadOnlyTool<FixDryRunArgsT, FixDryRunResult> = defineReadOnlyTool({
  name: 'fix_dry_run',
  description: 'Preview machine-applicable fixes (stub - returns empty edit list at v1).',
  schema: FixDryRunArgs,
  handler: async (): Promise<ToolResult<FixDryRunResult>> => {
    return wrapResult<FixDryRunResult>(
      Object.freeze({
        edits: Object.freeze([]) as readonly FixDryRunEdit[],
        note: 'fix_dry_run: edit computation lands in Phase 3h.6' as const,
      }),
      buildMeta([]),
    );
  },
});
