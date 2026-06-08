/**
 * @fugazi/node types — public surface for programmatic consumers.
 *
 * Phase 3h.5 (T201-T204) lands six top-level functions: `analyze`, `findDupes`,
 * `health`, `audit`, `traceFile`, `traceExport`. Per IMP-API-02 the
 * `detect_dead_code` / `detect_unused_files` / `detect_unused_exports`
 * trio collapses into a single `analyze()` with a discriminated `rules`
 * option — passing an explicit RuleId list emulates the per-rule helpers.
 *
 * All shapes are deeply readonly to preserve the determinism guarantees of the
 * underlying `runAnalysis()` driver (NFR-1 / SC-15 / SC-26): output is
 * byte-equal across runs and across concurrent calls.
 */

import type { FugaziConfig } from '@fugazi/config';
import type {
  AnalysisMetrics,
  ProgressEvent,
  RebaseAutoExplicit,
  RefactorTarget,
  RuntimeReport,
} from '@fugazi/core';
import type { CodeDuplicationIssue, DiscriminatedIssue, RuleId } from '@fugazi/types';
import type { CoverageInput } from '@fugazi/v8-coverage';

/**
 * Coverage-root mode — passthrough to the driver. `'auto'` runs the
 * longest-common-prefix detector; the explicit form is delegated straight to
 * `rebaseCoverage`.
 */
export type CoverageRootOption = 'auto' | RebaseAutoExplicit;

/**
 * Discriminated rule selection for `analyze()`.
 *
 *   - `'all'` (or `undefined`): every rule whose configured severity is not
 *     `'off'` fires.
 *   - `readonly RuleId[]`: only the listed rules fire — every other rule is
 *     forced to `'off'` via a config-rule override. Per IMP-API-02 this is the
 *     replacement for the `detect_dead_code`, `detect_unused_files`,
 *     `detect_unused_exports` helpers.
 */
export type AnalyzeRulesOption = 'all' | readonly RuleId[];

/** Common option shape for analysis-flavoured calls. */
interface BaseAnalysisOptions {
  readonly projectRoot: string;
  readonly config?: FugaziConfig;
  readonly abortSignal?: AbortSignal;
}

/* -------------------------------------------------------------------------- */
/* analyze                                                                     */
/* -------------------------------------------------------------------------- */

export interface AnalyzeOptions extends BaseAnalysisOptions {
  readonly rules?: AnalyzeRulesOption;
  readonly onProgress?: (event: ProgressEvent) => void;
  readonly coverage?: CoverageInput;
  readonly coverageRoot?: CoverageRootOption;
}

export interface AnalyzeResult {
  readonly issues: readonly DiscriminatedIssue[];
  readonly metrics: AnalysisMetrics;
  readonly runtime?: RuntimeReport;
  readonly _meta: { readonly version: string; readonly determinismHash: string };
}

/* -------------------------------------------------------------------------- */
/* findDupes                                                                   */
/* -------------------------------------------------------------------------- */

export interface FindDupesOptions extends BaseAnalysisOptions {
  /**
   * Minimum token count for a clone candidate. v1 limitation: this knob is
   * accepted on the surface but the underlying `code-duplication` rule sources
   * its threshold from `FugaziConfig`/rule defaults. Wired through in a later
   * phase.
   */
  readonly minTokens?: number;
}

export interface DupesResult {
  readonly cloneFamilies: readonly CodeDuplicationIssue[];
  readonly metrics: AnalysisMetrics;
}

/* -------------------------------------------------------------------------- */
/* health                                                                      */
/* -------------------------------------------------------------------------- */

export interface HealthOptions extends BaseAnalysisOptions {
  readonly coverage?: CoverageInput;
  readonly coverageRoot?: CoverageRootOption;
}

export interface HealthResult {
  /** `complexity-hotspot` + `cognitive-complexity` findings. */
  readonly issues: readonly DiscriminatedIssue[];
  /**
   * Project-level health score in [0, 100]. v1 limitation: the per-file
   * complexity map is not currently exposed on `RunAnalysisResult`, so this
   * field is `undefined` in 3h.5 and will populate when the driver surfaces
   * the complexity map publicly.
   */
  readonly score?: number;
  /**
   * Top refactor targets ordered by descending priority. v1 limitation: see
   * `score` — undefined until the complexity map is reachable.
   */
  readonly refactorTargets?: readonly RefactorTarget[];
  readonly runtime?: RuntimeReport;
  readonly metrics: AnalysisMetrics;
}

/* -------------------------------------------------------------------------- */
/* audit                                                                       */
/* -------------------------------------------------------------------------- */

export interface AuditOptions extends BaseAnalysisOptions {
  readonly coverage?: CoverageInput;
  readonly coverageRoot?: CoverageRootOption;
}

export interface AuditResult {
  /** Always empty — audit mode emits zero diagnostics by contract. */
  readonly issues: readonly DiscriminatedIssue[];
  readonly inventory: { readonly fileCount: number; readonly edgeCount: number };
  readonly runtime?: RuntimeReport;
  readonly metrics: AnalysisMetrics;
}

/* -------------------------------------------------------------------------- */
/* trace                                                                       */
/* -------------------------------------------------------------------------- */

export interface TraceFileOptions extends BaseAnalysisOptions {
  /** Absolute or project-relative path to the target file. */
  readonly targetFile: string;
}

export interface TraceExportOptions extends BaseAnalysisOptions {
  /** Named export to trace across the reverse-import index. */
  readonly exportName: string;
}

export interface TraceResult {
  /**
   * Each chain is a path-list ordered from a discovered importer to the
   * target. For 3h.5 we surface the flat reachable-set as length-1 chains
   * (mirroring the CLI `trace` command); a future expansion may emit full
   * BFS path-lists.
   */
  readonly chains: readonly (readonly string[])[];
  /** Resolved absolute POSIX path of the trace target (file or export). */
  readonly target: string;
}
