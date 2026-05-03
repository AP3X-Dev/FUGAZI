/**
 * tools/audit.ts — Phase 3h.4 (T196) — `audit` tool.
 *
 * Read-only. Wraps `audit()` from `@fugazi/node`. Returns inventory
 * counts only (zero diagnostics by audit-mode contract).
 */

import { type AuditResult, audit } from '@fugazi/node';
import type { z } from 'zod';
import { BaseAnalysisArgs, runWithMeta } from '../common.js';
import { type ReadOnlyTool, type ToolResult, defineReadOnlyTool } from '../types.js';

export const AuditArgs = BaseAnalysisArgs;
export type AuditArgsT = z.infer<typeof AuditArgs>;

export const auditTool: ReadOnlyTool<AuditArgsT, AuditResult> = defineReadOnlyTool({
  name: 'audit',
  description: 'Walk discover + extract + graph and emit zero diagnostics (inventory only).',
  schema: AuditArgs,
  handler: async (input): Promise<ToolResult<AuditResult>> => {
    return runWithMeta<AuditResult>(() =>
      audit({
        projectRoot: input.projectRoot,
      }),
    );
  },
});
