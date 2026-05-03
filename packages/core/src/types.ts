/**
 * types.ts — Phase 3f.1 (T131-T134) — analysis-driver types.
 *
 * `runAnalysis()` is the single shared entry point used by every consumer
 * (CLI, LSP, MCP, programmatic Node API). Its options/result shapes live here
 * so consumers can wire up their glue against a stable surface even before the
 * per-rule sub-phases (3f.2..3f.6) populate the actual diagnostic stream.
 *
 * Determinism (NFR-1 / SC-15): every shape is deeply readonly. The driver
 * sorts diagnostics + actions by `(file, range.start.byteOffset, ruleId)` and
 * emits a SHA-256 `_meta.determinismHash` over the canonical-sorted JSON,
 * proving byte-equality across runs.
 */

import type { FugaziConfig } from '@fugazi/config';
import type { Graph } from '@fugazi/graph';
import type { PluginDef } from '@fugazi/plugins';
import type { DiscriminatedIssue, Range, RuleId } from '@fugazi/types';
import type { CoverageInput } from '@fugazi/v8-coverage';
import type { RebaseMode } from './runtime/coverage-rebase.js';
import type { RuntimeReport } from './runtime/runtime-report.js';

/**
 * AnalysisMode — five closed values controlling which rules dispatch.
 *
 *   - `full`           — run every enabled rule.
 *   - `dead-code-only` — run only the `unused-*` family of rules.
 *   - `dupes-only`     — run only the duplicate-detection rules.
 *   - `health-only`    — run only complexity / maintainability-index /
 *                        refactor-target rules.
 *   - `audit`          — read-only diagnostic dump. The driver still walks
 *                        discover + extract + graph but emits zero diagnostics
 *                        and no fix actions; useful for surfacing the
 *                        inventory + edge-set metadata in `_meta`.
 *
 * Phase 3f.1 wires the driver scaffolding only — actual rule dispatch lands
 * in 3f.2 onward. Until then, every mode emits zero diagnostics.
 */
export type AnalysisMode = 'full' | 'dead-code-only' | 'dupes-only' | 'health-only' | 'audit';

export interface RunAnalysisOptions {
  readonly kind: AnalysisMode;
  readonly config: FugaziConfig;
  readonly projectRoot: string;
  readonly abortSignal?: AbortSignal;
  readonly onProgress?: (event: ProgressEvent) => void;
  /**
   * Optional pre-built graph. When supplied the driver skips the discover +
   * extract + graph-build phases and uses the provided graph directly. Used
   * by the LSP for incremental scans where the graph is maintained
   * cross-request. Progress events are still emitted for visibility (with
   * zero counts where applicable).
   */
  readonly preBuiltGraph?: Graph;
  /**
   * Optional V8 coverage payload. When present the driver runs the runtime
   * pipeline (`runRuntime`) after the static analyze + crossref passes and
   * attaches the resulting `RuntimeReport` to `RunAnalysisResult.runtime`.
   * `root` is the rebase mode — explicit `{ from, to }` or `'auto'`.
   */
  readonly coverage?: {
    readonly input: CoverageInput;
    readonly root?: RebaseMode;
  };
  /**
   * Override the bundled plugin list (Phase 3i Wave B). When `undefined`
   * the driver loads `BUILTIN_PLUGINS` from `@fugazi/plugins`. Test
   * harnesses pass explicit lists to keep activation deterministic.
   */
  readonly plugins?: readonly PluginDef[];
}

/**
 * Language tag carried on Phase 4e (T370) extract.* progress events. Optional
 * — events emitted from a per-language extract loop carry the matching tag so
 * UI consumers can render "Parsing Python files (50/200)…". Events from
 * code paths that don't dispatch per-language (`'extract.start'` outer event,
 * non-extract phases) omit the field. Closed set; v1 supports `'ts'` and
 * `'py'` only.
 */
export type ExtractLang = 'ts' | 'py';

/**
 * ProgressEvent — discriminated union over every life-cycle signal the driver
 * emits. Each event carries a monotonic `seq` so consumers can reorder
 * concurrent emissions deterministically.
 *
 * Eleven event kinds in canonical order:
 *
 *   discover.start  → discover.done
 *   extract.start   → extract.progress*  → extract.done
 *   graph.start     → graph.done
 *   analyze.start   → analyze.progress*  → analyze.done
 *   crossref.done
 *
 * `extract.progress` and `analyze.progress` may be emitted zero or more times.
 * The driver throttles `extract.progress` to ~20 ticks per run so very large
 * file sets don't flood the listener.
 *
 * Phase 4e (T370): every extract.* event carries an optional `lang` tag
 * (`'ts'` | `'py'`). Backwards-compat — pre-4e consumers ignore the field;
 * cross-language UIs use it to label per-language progress.
 */
export type ProgressEvent =
  | { readonly seq: number; readonly kind: 'discover.start' }
  | { readonly seq: number; readonly kind: 'discover.done'; readonly fileCount: number }
  | {
      readonly seq: number;
      readonly kind: 'extract.start';
      readonly total: number;
      readonly lang?: ExtractLang;
    }
  | {
      readonly seq: number;
      readonly kind: 'extract.progress';
      readonly n: number;
      readonly total: number;
      readonly lang?: ExtractLang;
    }
  | { readonly seq: number; readonly kind: 'extract.done'; readonly lang?: ExtractLang }
  | { readonly seq: number; readonly kind: 'graph.start' }
  | { readonly seq: number; readonly kind: 'graph.done'; readonly edgeCount: number }
  | { readonly seq: number; readonly kind: 'analyze.start'; readonly ruleCount: number }
  | {
      readonly seq: number;
      readonly kind: 'analyze.progress';
      readonly rule: RuleId;
      readonly n: number;
      readonly total: number;
    }
  | { readonly seq: number; readonly kind: 'analyze.done' }
  | { readonly seq: number; readonly kind: 'crossref.done' }
  | { readonly seq: number; readonly kind: 'runtime.start' }
  | { readonly seq: number; readonly kind: 'runtime.done' };

/**
 * `Edit` — a single text replacement scoped to one file and one range.
 *
 * Phase 3f.1 the driver emits zero edits; the field exists so the surface is
 * stable for 3h (fix engine).
 */
export interface Edit {
  readonly file: string;
  readonly range: Range;
  readonly newText: string;
}

/**
 * `AnalysisAction` — a machine-applicable fix derived from a diagnostic.
 *
 * The driver emits an empty `actions` array in `audit` mode and during 3f.1
 * scaffolding. Actual fix derivation begins in 3h.
 */
export interface AnalysisAction {
  readonly kind: 'remove' | 'rename' | 'replace';
  readonly diagnostic: DiscriminatedIssue;
  readonly description: string;
  readonly edits: readonly Edit[];
}

/**
 * Per-language file count surfaced on `AnalysisMetrics.filesByLang`. Phase
 * 4e (T361) — adds observability for mixed TS+Python projects. Counts mirror
 * `filesScanned` (post-extract) and sum to it. Languages with zero matches
 * are still present with a count of `0` so consumers can rely on the keyset.
 */
export interface FilesByLang {
  readonly ts: number;
  readonly py: number;
}

/**
 * Parse-error summary surfaced on `AnalysisMetrics.parseErrors`. Phase 4e
 * (T361). Each entry is `{ file, lang }` — verbatim per-error messages stay
 * inside the parser layer; the metrics surface only counts + provenance so
 * consumers can render `"3 parse errors (2 in Python files)"` without
 * round-tripping the full error array. `total` is the sum of `byLang`
 * values.
 */
export interface ParseErrorSummary {
  readonly total: number;
  readonly byLang: FilesByLang;
}

/**
 * `AnalysisMetrics` — observability snapshot for the run.
 *
 *   - `filesScanned`        files that produced an inventory (post-extract).
 *   - `diagnosticsByRule`   per-RuleId issue count; missing keys are 0.
 *   - `elapsedMs`           wall-clock elapsed via `performance.now()` deltas.
 *                           Non-deterministic — for human display only. The
 *                           determinism hash strips this field before hashing.
 *   - `cacheHitRate`        parse-cache hit ratio in `[0, 1]`. 0 when no cache
 *                           is wired; populated in 3f.2+.
 *   - `filesByLang`         per-language file count (Phase 4e T361).
 *   - `parseErrors`         per-run parse error summary (Phase 4e T361).
 */
export interface AnalysisMetrics {
  readonly filesScanned: number;
  readonly diagnosticsByRule: Readonly<Partial<Record<RuleId, number>>>;
  /** Non-deterministic — for human display only. Stripped before hashing. */
  readonly elapsedMs: number;
  readonly cacheHitRate: number;
  readonly filesByLang: FilesByLang;
  readonly parseErrors: ParseErrorSummary;
}

/**
 * `RunAnalysisResult` — the canonical return shape for `runAnalysis()`.
 *
 *   - `issues`           all diagnostics, sorted deterministically by
 *                        `(file, range.start.byteOffset, ruleId)`.
 *   - `actions`          machine-applicable fixes; empty in `audit` mode.
 *   - `metrics`          observability snapshot.
 *   - `progressEvents`   the emitted progress sequence in `seq` order.
 *   - `_meta.version`    package version (from @fugazi/core package.json).
 *   - `_meta.mode`       the requested AnalysisMode (passthrough).
 *   - `_meta.determinismHash`  SHA-256 of canonical JSON over
 *                              `{ issues, actions }` — proves byte-equality.
 */
export interface RunAnalysisResult {
  readonly issues: readonly DiscriminatedIssue[];
  readonly actions: readonly AnalysisAction[];
  readonly metrics: AnalysisMetrics;
  readonly progressEvents: readonly ProgressEvent[];
  /**
   * Runtime-intelligence report — populated only when `options.coverage` was
   * supplied. Omitted (per `exactOptionalPropertyTypes`) otherwise.
   */
  readonly runtime?: RuntimeReport;
  /**
   * Framework plugins activated for this project (Phase 3i Wave B). Names
   * only — full PluginDef stays internal to keep the surface small.
   * Empty when no plugin's enablers / detection matched.
   */
  readonly activePlugins?: readonly string[];
  readonly _meta: {
    readonly version: string;
    readonly mode: AnalysisMode;
    readonly determinismHash: string;
  };
}
