/**
 * tools/index.ts — Phase 3h.4 (T196-T200) — registry of the 15 MCP tools.
 *
 * The order in `ALL_TOOLS` is the canonical advertise order — `tools/list`
 * emits the names in this order so MCP clients see a stable surface across
 * runs. The runtime `verifyRegistry()` helper enforces:
 *
 *   - exactly 15 tools registered,
 *   - exactly 14 read-only and 1 mutating (`fix_apply`),
 *   - no duplicate names.
 */

import {
  type AnyMutatingTool,
  type AnyReadOnlyTool,
  type AnyTool,
  isMutatingTool,
  isReadOnlyTool,
} from '../types.js';
import { analyzeTool } from './analyze.js';
import { auditTool } from './audit.js';
import { boundariesTool } from './boundaries.js';
import { coverageSetupTool } from './coverage-setup.js';
import { deadCodeTool } from './dead-code.js';
import { dupesTool } from './dupes.js';
import { explainTool } from './explain.js';
import { fixApplyTool } from './fix-apply.js';
import { fixDryRunTool } from './fix-dry-run.js';
import { healthTool } from './health.js';
import { initTool } from './init.js';
import { runtimeReportTool } from './runtime-report.js';
import { schemaTool } from './schema.js';
import { traceExportTool } from './trace-export.js';
import { traceFileTool } from './trace-file.js';

export {
  analyzeTool,
  auditTool,
  boundariesTool,
  coverageSetupTool,
  deadCodeTool,
  dupesTool,
  explainTool,
  fixApplyTool,
  fixDryRunTool,
  healthTool,
  initTool,
  runtimeReportTool,
  schemaTool,
  traceExportTool,
  traceFileTool,
};

/**
 * The 15 tools, in canonical advertise order. Type-erased so heterogeneous
 * tool definitions (different I/O types) can sit in one collection.
 */
export const ALL_TOOLS: readonly AnyTool[] = Object.freeze([
  analyzeTool as unknown as AnyTool,
  deadCodeTool as unknown as AnyTool,
  dupesTool as unknown as AnyTool,
  healthTool as unknown as AnyTool,
  auditTool as unknown as AnyTool,
  traceFileTool as unknown as AnyTool,
  traceExportTool as unknown as AnyTool,
  boundariesTool as unknown as AnyTool,
  explainTool as unknown as AnyTool,
  schemaTool as unknown as AnyTool,
  initTool as unknown as AnyTool,
  coverageSetupTool as unknown as AnyTool,
  fixApplyTool as unknown as AnyTool,
  fixDryRunTool as unknown as AnyTool,
  runtimeReportTool as unknown as AnyTool,
]);

/** Closed name set — tracked here so tests can assert exactness. */
export const TOOL_NAMES = Object.freeze([
  'analyze',
  'dead_code',
  'dupes',
  'health',
  'audit',
  'trace_file',
  'trace_export',
  'boundaries',
  'explain',
  'schema',
  'init',
  'coverage_setup',
  'fix_apply',
  'fix_dry_run',
  'runtime_report',
] as const);

export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * Runtime back-stop for the type-level read-only invariant. Throws on:
 *   - wrong tool count,
 *   - duplicate names,
 *   - any mutating tool other than `fix_apply`,
 *   - `fix_apply` declared as read-only.
 */
export function verifyRegistry(tools: readonly AnyTool[] = ALL_TOOLS): void {
  if (tools.length !== 15) {
    throw new Error(`MCP registry: expected 15 tools, got ${tools.length}`);
  }
  const seen = new Set<string>();
  let mutatingCount = 0;
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(`MCP registry: duplicate tool name: ${tool.name}`);
    }
    seen.add(tool.name);
    if (isMutatingTool(tool)) {
      mutatingCount += 1;
      if (tool.name !== 'fix_apply') {
        throw new Error(`MCP registry: only fix_apply may mutate; got mutating tool: ${tool.name}`);
      }
    } else if (!isReadOnlyTool(tool)) {
      // Defensive: every AnyTool is either read or mutate. If a third mode
      // is added without updating the registry guard, surface it loudly.
      const unknownTool = tool as { readonly name?: string };
      throw new Error(
        `MCP registry: tool ${unknownTool.name ?? '<unknown>'} has no recognised mode brand`,
      );
    }
  }
  if (mutatingCount !== 1) {
    throw new Error(`MCP registry: expected exactly 1 mutating tool, got ${mutatingCount}`);
  }
}

export type { AnyMutatingTool, AnyReadOnlyTool, AnyTool };
