/**
 * tools/runtime-report.ts — Phase 3h.4 (T196) — `runtime_report` tool.
 *
 * Read-only. Runs the full analysis with coverage input attached, then
 * surfaces the runtime block (hot paths / cold code / weighted score).
 *
 * v1 limitation: coverage is supplied as a path to a V8 ScriptCoverage JSON
 * file. The file is parsed via `@fugazi/v8-coverage` and forwarded to the
 * driver. A future expansion may accept inline JSON.
 */

import { type AnalyzeResult, analyze } from '@fugazi/node-api';
import { parseCoverageFile } from '@fugazi/v8-coverage';
import { z } from 'zod';
import { BaseAnalysisArgs, runWithMeta } from '../common.js';
import { buildMeta, wrapError } from '../meta.js';
import { type ReadOnlyTool, type ToolResult, defineReadOnlyTool } from '../types.js';

export const RuntimeReportArgs = BaseAnalysisArgs.extend({
  coveragePath: z.string().min(1),
});

export type RuntimeReportArgsT = z.infer<typeof RuntimeReportArgs>;

export const runtimeReportTool: ReadOnlyTool<RuntimeReportArgsT, AnalyzeResult> =
  defineReadOnlyTool({
    name: 'runtime_report',
    description:
      'Run analysis with V8 coverage attached and return the runtime intelligence block.',
    schema: RuntimeReportArgs,
    handler: async (input): Promise<ToolResult<AnalyzeResult>> => {
      let coverage: Awaited<ReturnType<typeof parseCoverageFile>>;
      try {
        coverage = await parseCoverageFile(input.coveragePath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return wrapError(`runtime_report: failed to load coverage: ${message}`, buildMeta([]));
      }
      return runWithMeta<AnalyzeResult>((record) =>
        analyze({
          projectRoot: input.projectRoot,
          coverage,
          onProgress: record,
        }),
      );
    },
  });
