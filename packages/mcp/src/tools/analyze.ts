/**
 * tools/analyze.ts — Phase 3h.4 (T196) — `analyze` tool.
 *
 * Thin wrapper over `@fugazi/node` `analyze()`. Read-only — runs the full
 * `runAnalysis({ kind: 'full' })` driver and returns the issue stream + metrics.
 */

import { type AnalyzeResult, type AnalyzeRulesOption, analyze } from '@fugazi/node';
import type { RuleId } from '@fugazi/types';
import { z } from 'zod';
import { BaseAnalysisArgs, runWithMeta } from '../common.js';
import { RULE_IDS } from '../rule-descriptions.js';
import { type ReadOnlyTool, type ToolResult, defineReadOnlyTool } from '../types.js';

const RuleIdEnum = z.enum(RULE_IDS as readonly [RuleId, ...RuleId[]]);

export const AnalyzeArgs = BaseAnalysisArgs.extend({
  rules: z.union([z.literal('all'), z.array(RuleIdEnum)]).optional(),
});

export type AnalyzeArgsT = z.infer<typeof AnalyzeArgs>;

export const analyzeTool: ReadOnlyTool<AnalyzeArgsT, AnalyzeResult> = defineReadOnlyTool({
  name: 'analyze',
  description: 'Run the full Fugazi analysis pipeline (every enabled rule).',
  schema: AnalyzeArgs,
  handler: async (input): Promise<ToolResult<AnalyzeResult>> => {
    const rulesArg: AnalyzeRulesOption | undefined = input.rules;
    return runWithMeta<AnalyzeResult>((record) =>
      analyze({
        projectRoot: input.projectRoot,
        ...(rulesArg !== undefined ? { rules: rulesArg } : {}),
        onProgress: record,
      }),
    );
  },
});
