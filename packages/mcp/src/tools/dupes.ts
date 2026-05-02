/**
 * tools/dupes.ts — Phase 3h.4 (T196) — `dupes` tool.
 *
 * Read-only. Wraps `findDupes()` from `@fugazi/node-api`.
 */

import { type DupesResult, findDupes } from '@fugazi/node-api';
import { z } from 'zod';
import { BaseAnalysisArgs, runWithMeta } from '../common.js';
import { type ReadOnlyTool, type ToolResult, defineReadOnlyTool } from '../types.js';

export const DupesArgs = BaseAnalysisArgs.extend({
  minTokens: z.number().int().positive().optional(),
});

export type DupesArgsT = z.infer<typeof DupesArgs>;

export const dupesTool: ReadOnlyTool<DupesArgsT, DupesResult> = defineReadOnlyTool({
  name: 'dupes',
  description: 'Detect code clones (the code-duplication rule only).',
  schema: DupesArgs,
  handler: async (input): Promise<ToolResult<DupesResult>> => {
    return runWithMeta<DupesResult>(() =>
      findDupes({
        projectRoot: input.projectRoot,
        ...(input.minTokens !== undefined ? { minTokens: input.minTokens } : {}),
      }),
    );
  },
});
