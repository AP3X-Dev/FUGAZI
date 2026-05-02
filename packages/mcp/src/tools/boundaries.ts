/**
 * tools/boundaries.ts — Phase 3h.4 (T196) — `boundaries` tool.
 *
 * Read-only. Single-rule shortcut for `boundary-violations`. Mirrors the CLI
 * `boundaries` shortcut by passing a one-element rule allowlist to
 * `analyze()`.
 */

import { type AnalyzeResult, analyze } from '@fugazi/node-api';
import type { RuleId } from '@fugazi/types';
import type { z } from 'zod';
import { BaseAnalysisArgs, runWithMeta } from '../common.js';
import { type ReadOnlyTool, type ToolResult, defineReadOnlyTool } from '../types.js';

const BOUNDARY_RULES: readonly RuleId[] = Object.freeze(['boundary-violations']);

export const BoundariesArgs = BaseAnalysisArgs;
export type BoundariesArgsT = z.infer<typeof BoundariesArgs>;

export const boundariesTool: ReadOnlyTool<BoundariesArgsT, AnalyzeResult> = defineReadOnlyTool({
  name: 'boundaries',
  description: 'Run only the boundary-violations rule.',
  schema: BoundariesArgs,
  handler: async (input): Promise<ToolResult<AnalyzeResult>> => {
    return runWithMeta<AnalyzeResult>((record) =>
      analyze({
        projectRoot: input.projectRoot,
        rules: BOUNDARY_RULES,
        onProgress: record,
      }),
    );
  },
});
