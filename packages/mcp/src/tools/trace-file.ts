/**
 * tools/trace-file.ts — Phase 3h.4 (T196) — `trace_file` tool.
 *
 * Read-only. Wraps `traceFile()` from `@fugazi/node`.
 */

import { type TraceResult, traceFile } from '@fugazi/node';
import { z } from 'zod';
import { BaseAnalysisArgs, runWithMeta } from '../common.js';
import { type ReadOnlyTool, type ToolResult, defineReadOnlyTool } from '../types.js';

export const TraceFileArgs = BaseAnalysisArgs.extend({
  targetFile: z.string().min(1),
});

export type TraceFileArgsT = z.infer<typeof TraceFileArgs>;

export const traceFileTool: ReadOnlyTool<TraceFileArgsT, TraceResult> = defineReadOnlyTool({
  name: 'trace_file',
  description:
    'Walk the reverse-import index from a target file. Returns reachable importer paths.',
  schema: TraceFileArgs,
  handler: async (input): Promise<ToolResult<TraceResult>> => {
    return runWithMeta<TraceResult>(() =>
      traceFile({ projectRoot: input.projectRoot, targetFile: input.targetFile }),
    );
  },
});
