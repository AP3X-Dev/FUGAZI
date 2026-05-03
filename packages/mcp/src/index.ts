/**
 * @fugazi/mcp — Phase 3h.4 (T195-T200) — MCP server entry.
 *
 * The package exposes a single `start()` entry consumed by `bin/fugazi-mcp.js`
 * plus the registry helpers and types so the test harness can dispatch tools
 * directly against the in-process Server. Per D1 the server runs in-process
 * and links `@fugazi/core` directly — no subprocess spawn anywhere in this
 * package.
 */

export { buildRegistry, startServer, type RegistryHandle } from './server.js';
export {
  ALL_TOOLS,
  TOOL_NAMES,
  verifyRegistry,
  type ToolName,
  type AnyMutatingTool,
  type AnyReadOnlyTool,
  type AnyTool,
} from './tools/index.js';
export {
  defineMutatingTool,
  defineReadOnlyTool,
  isMutatingTool,
  isReadOnlyTool,
  type MutatingTool,
  type ReadOnlyTool,
  type ToolMeta,
  type ToolMetaProgressEntry,
  type ToolResult,
  type ToolResultErr,
  type ToolResultOk,
} from './types.js';
export { buildMeta, openMeta, wrapError, wrapResult, type MetaSources } from './meta.js';
export { withValidation } from './validate.js';
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
} from './tools/index.js';

/** Backwards-compat alias used by `bin/fugazi-mcp.js`. */
export { startServer as start } from './server.js';
