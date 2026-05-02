/**
 * tools/health.ts — Phase 3h.4 (T196) — `health` tool.
 *
 * Read-only. Wraps `health()` from `@fugazi/node-api` for the
 * complexity-hotspot + cognitive-complexity rule pair.
 */

import { type HealthResult, health } from '@fugazi/node-api';
import type { z } from 'zod';
import { BaseAnalysisArgs, runWithMeta } from '../common.js';
import { type ReadOnlyTool, type ToolResult, defineReadOnlyTool } from '../types.js';

export const HealthArgs = BaseAnalysisArgs;
export type HealthArgsT = z.infer<typeof HealthArgs>;

export const healthTool: ReadOnlyTool<HealthArgsT, HealthResult> = defineReadOnlyTool({
  name: 'health',
  description: 'Compute project health (cyclomatic and cognitive complexity rules).',
  schema: HealthArgs,
  handler: async (input): Promise<ToolResult<HealthResult>> => {
    return runWithMeta<HealthResult>(() =>
      health({
        projectRoot: input.projectRoot,
      }),
    );
  },
});
