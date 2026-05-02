/**
 * @fugazi/core — public surface.
 *
 * Phase 3f.1 (T131-T134) ships the single shared `runAnalysis()` driver and
 * its progress-event contract. Subsequent sub-phases (3f.2 dead-code, 3f.3
 * boundaries, 3f.4 duplicates, 3f.5 health, 3f.6 cross-reference) populate
 * actual rule dispatch on top of the same surface; consumers (CLI, LSP, MCP,
 * Node API) integrate now and inherit rules as they land.
 */

export { ProgressEmitter, type ProgressEventBody } from './progress.js';
export { runAnalysis } from './run-analysis.js';
export type {
  AnalysisAction,
  AnalysisMetrics,
  AnalysisMode,
  Edit,
  ProgressEvent,
  RunAnalysisOptions,
  RunAnalysisResult,
} from './types.js';
