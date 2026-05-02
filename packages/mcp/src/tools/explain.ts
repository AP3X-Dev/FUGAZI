/**
 * tools/explain.ts — Phase 3h.4 (T197) — `explain` tool.
 *
 * Read-only. Returns the Markdown blurb for a single RuleId. Unknown rule
 * names map to a `{ error: true }` envelope with the verbatim message
 * `explain: unknown rule id: <name>`.
 */

import { z } from 'zod';
import { buildMeta, wrapError, wrapResult } from '../meta.js';
import { RULE_DESCRIPTIONS } from '../rule-descriptions.js';
import { type ReadOnlyTool, type ToolResult, defineReadOnlyTool } from '../types.js';

export const ExplainArgs = z.object({
  ruleId: z.string().min(1),
});

export type ExplainArgsT = z.infer<typeof ExplainArgs>;

export interface ExplainResult {
  readonly ruleId: string;
  readonly markdown: string;
}

export const explainTool: ReadOnlyTool<ExplainArgsT, ExplainResult> = defineReadOnlyTool({
  name: 'explain',
  description: 'Return the Markdown description for a single RuleId.',
  schema: ExplainArgs,
  handler: async (input): Promise<ToolResult<ExplainResult>> => {
    const text = (RULE_DESCRIPTIONS as Record<string, string | undefined>)[input.ruleId];
    if (text === undefined) {
      return wrapError(`explain: unknown rule id: ${input.ruleId}`, buildMeta([]));
    }
    return wrapResult<ExplainResult>(
      Object.freeze({ ruleId: input.ruleId, markdown: text }),
      buildMeta([]),
    );
  },
});
