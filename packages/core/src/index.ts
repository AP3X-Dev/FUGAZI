/**
 * @fugazi/core — public surface.
 *
 * Phase 3f.1 (T131-T134) shipped the single shared `runAnalysis()` driver and
 * its progress-event contract. Phase 3f.2 Wave 1 lights up the rule-registry
 * pattern and the three graph-reachability rules (unused-files,
 * unused-exports, unused-types). Subsequent sub-phases (3f.3 boundaries, 3f.4
 * duplicates, 3f.5 health, 3f.6 cross-reference) populate additional rule
 * dispatch on top of the same surface.
 */

export { ProgressEmitter, type ProgressEventBody } from './progress.js';
export { runAnalysis } from './run-analysis.js';
export {
  DEAD_CODE_RULES,
  DUPES_RULES,
  HEALTH_RULES,
  RULES,
  listEnabledRules,
  runEnabledRules,
  severityFor,
  type RuleFactory,
  type RunEnabledRulesResult,
} from './rules/registry.js';
export type { RuleContext, RuleHandler } from './rules/types.js';
export type {
  AnalysisAction,
  AnalysisMetrics,
  AnalysisMode,
  Edit,
  ProgressEvent,
  RunAnalysisOptions,
  RunAnalysisResult,
} from './types.js';
