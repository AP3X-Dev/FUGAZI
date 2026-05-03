/**
 * tools/coverage-setup.ts — Phase 3h.6 (T215-T217) — `coverage_setup` tool.
 *
 * Read-only wizard. Detects the project's test runner(s) and returns a
 * structured list of `{ runner, snippet, configPath }` entries. v1 prints
 * only — does NOT write to user config files.
 */

import {
  NO_RUNNER_MESSAGE,
  type RunnerSnippet,
  type SupportedRunner,
  buildSnippets,
  detectRunners,
} from '@fugazi/core';
import { z } from 'zod';
import { buildMeta, wrapError, wrapResult } from '../meta.js';
import { type ReadOnlyTool, type ToolResult, defineReadOnlyTool } from '../types.js';

export const CoverageSetupArgs = z.object({
  projectRoot: z.string().min(1),
});

export type CoverageSetupArgsT = z.infer<typeof CoverageSetupArgs>;

export interface CoverageSetupResult {
  readonly detected: readonly SupportedRunner[];
  readonly snippets: readonly RunnerSnippet[];
}

export const coverageSetupTool: ReadOnlyTool<CoverageSetupArgsT, CoverageSetupResult> =
  defineReadOnlyTool({
    name: 'coverage_setup',
    description: 'Detect test runners and emit V8-coverage configuration snippets.',
    schema: CoverageSetupArgs,
    handler: async (input): Promise<ToolResult<CoverageSetupResult>> => {
      const detected = await detectRunners({ projectRoot: input.projectRoot });
      if (detected.length === 0) {
        return wrapError(NO_RUNNER_MESSAGE, buildMeta([]));
      }
      const snippets = buildSnippets(input.projectRoot, detected);
      return wrapResult<CoverageSetupResult>(
        Object.freeze({
          detected,
          snippets,
        }) satisfies CoverageSetupResult,
        buildMeta([]),
      );
    },
  });
