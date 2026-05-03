/**
 * tools/dead-code.ts — Phase 3h.4 (T196) — `dead_code` tool.
 *
 * Read-only. Dispatches the dead-code rule family via `analyze({ rules: [...] })`
 * with the dead-code RuleIds whitelisted.
 */

import { type AnalyzeResult, analyze } from '@fugazi/node';
import type { RuleId } from '@fugazi/types';
import type { z } from 'zod';
import { BaseAnalysisArgs, runWithMeta } from '../common.js';
import { type ReadOnlyTool, type ToolResult, defineReadOnlyTool } from '../types.js';

const DEAD_CODE_RULES: readonly RuleId[] = Object.freeze([
  'unused-files',
  'unused-exports',
  'unused-types',
  'unused-deps',
  'unused-dev-deps',
  'unused-optional-deps',
  'unused-enum-members',
  'unused-class-members',
  'unresolved-imports',
  'unlisted-dependencies',
  'duplicate-exports',
  'private-type-leak',
]);

export const DeadCodeArgs = BaseAnalysisArgs;
export type DeadCodeArgsT = z.infer<typeof DeadCodeArgs>;

export const deadCodeTool: ReadOnlyTool<DeadCodeArgsT, AnalyzeResult> = defineReadOnlyTool({
  name: 'dead_code',
  description: 'Run the dead-code rule family (unused files, exports, deps, types, members).',
  schema: DeadCodeArgs,
  handler: async (input): Promise<ToolResult<AnalyzeResult>> => {
    return runWithMeta<AnalyzeResult>((record) =>
      analyze({
        projectRoot: input.projectRoot,
        rules: DEAD_CODE_RULES,
        onProgress: record,
      }),
    );
  },
});
