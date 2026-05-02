/**
 * tools/coverage-setup.ts — Phase 3h.4 (T200) — `coverage_setup` STUB.
 *
 * Read-only stub. Body lands in Phase 3h.6. Returns a verbatim
 * not-implemented envelope.
 */

import { z } from 'zod';
import { buildMeta, wrapError } from '../meta.js';
import { type ReadOnlyTool, type ToolResult, defineReadOnlyTool } from '../types.js';

export const CoverageSetupArgs = z.object({
  projectRoot: z.string().min(1),
});

export type CoverageSetupArgsT = z.infer<typeof CoverageSetupArgs>;

export interface CoverageSetupResult {
  readonly stub: true;
}

export const COVERAGE_SETUP_MESSAGE = 'coverage_setup: not implemented yet (Phase 3h.6)';

export const coverageSetupTool: ReadOnlyTool<CoverageSetupArgsT, CoverageSetupResult> =
  defineReadOnlyTool({
    name: 'coverage_setup',
    description: 'Wire up V8 coverage capture (stub - lands in Phase 3h.6).',
    schema: CoverageSetupArgs,
    handler: async (): Promise<ToolResult<CoverageSetupResult>> => {
      return wrapError(COVERAGE_SETUP_MESSAGE, buildMeta([]));
    },
  });
