/**
 * tools/trace-export.ts — Phase 3h.4 (T196) — `trace_export` tool.
 *
 * Read-only. Wraps `traceExport()` from `@fugazi/node`.
 */

import { type TraceResult, traceExport } from '@fugazi/node';
import { z } from 'zod';
import { BaseAnalysisArgs, runWithMeta } from '../common.js';
import { type ReadOnlyTool, type ToolResult, defineReadOnlyTool } from '../types.js';

export const TraceExportArgs = BaseAnalysisArgs.extend({
  exportName: z.string().min(1),
});

export type TraceExportArgsT = z.infer<typeof TraceExportArgs>;

export const traceExportTool: ReadOnlyTool<TraceExportArgsT, TraceResult> = defineReadOnlyTool({
  name: 'trace_export',
  description: 'Walk the reverse-import index for a named export. Returns importing paths.',
  schema: TraceExportArgs,
  handler: async (input): Promise<ToolResult<TraceResult>> => {
    return runWithMeta<TraceResult>(() =>
      traceExport({ projectRoot: input.projectRoot, exportName: input.exportName }),
    );
  },
});
