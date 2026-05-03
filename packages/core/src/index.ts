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

export {
  applyCrossReferenceFilter,
  type CrossReferenceResult,
} from './cross-ref.js';
export {
  NO_RUNNER_MESSAGE,
  SUPPORTED_RUNNERS,
  detectRunners,
  type SupportedRunner,
  type DetectRunnersOptions,
} from './coverage-setup/detect.js';
export { buildSnippets, type RunnerSnippet } from './coverage-setup/snippets.js';
export {
  applyFixes,
  spliceByByteOffset,
  DRIFT_MESSAGE_PREFIX,
  MISSING_FILE_PREFIX,
  OFFSET_OOB_PREFIX,
  type ApplyFixesOptions,
  type FileFixOutcome,
  type FixEngineResult,
  type PlannedFileFix,
} from './fix/engine.js';
export {
  computeFileScore,
  computeProjectScore,
  computeRefactorTargets,
  formatScoreLine,
  type HealthScore,
  type RefactorTarget,
  type ScoreWeights,
} from './health/index.js';
export { ProgressEmitter, type ProgressEventBody } from './progress.js';
export {
  CodeclimateReporter,
  CompactReporter,
  HumanPlainReporter,
  HumanReporter,
  JsonReporter,
  MarkdownReporter,
  SarifReporter,
  selectReporter,
} from './reporter/index.js';
export type { Reporter, ReporterFormat, ReporterMeta } from './reporter/index.js';
export { createCodeDuplicationRule } from './rules/code-duplication.js';
export { createCognitiveComplexityRule } from './rules/cognitive-complexity.js';
export { createComplexityHotspotRule } from './rules/complexity-hotspot.js';
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
export {
  buildCoverageIndex,
  computeWeightedFileScore,
  emptyRuntimeReport,
  findColdCode,
  findHotPaths,
  rebaseCoverageAuto,
  runRuntime,
  validateColumnTolerance,
} from './runtime/index.js';
export type {
  ColdCodeFinding,
  CoverageByFile,
  CoverageByFunction,
  CoverageIndex,
  FindColdCodeOptions,
  FindColdCodeResult,
  FindHotPathsOptions,
  HotPathFinding,
  RebaseAutoExplicit,
  RebaseAutoOptions,
  RebaseMode,
  RunRuntimeOptions,
  RuntimeReport,
  ValidateColumnToleranceOptions,
  WeightedScoreOptions,
} from './runtime/index.js';
export type {
  AnalysisAction,
  AnalysisMetrics,
  AnalysisMode,
  Edit,
  ProgressEvent,
  RunAnalysisOptions,
  RunAnalysisResult,
} from './types.js';
