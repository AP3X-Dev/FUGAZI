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
}

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
 */
export type ProgressEvent =
  | { readonly seq: number; readonly kind: 'discover.start' }
  | { readonly seq: number; readonly kind: 'discover.done'; readonly fileCount: number }
  | { readonly seq: number; readonly kind: 'extract.start'; readonly total: number }
  | {
      readonly seq: number;
      readonly kind: 'extract.progress';
      readonly n: number;
      readonly total: number;
    }
  | { readonly seq: number; readonly kind: 'extract.done' }
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
 * `AnalysisMetrics` — observability snapshot for the run.
 *
 *   - `filesScanned`        files that produced an inventory (post-extract).
 *   - `diagnosticsByRule`   per-RuleId issue count; missing keys are 0.
 *   - `elapsedMs`           wall-clock elapsed via `performance.now()` deltas.
 *                           Non-deterministic — for human display only. The
 *                           determinism hash strips this field before hashing.
 *   - `cacheHitRate`        parse-cache hit ratio in `[0, 1]`. 0 when no cache
 *                           is wired; populated in 3f.2+.
 */
export interface AnalysisMetrics {
  readonly filesScanned: number;
  readonly diagnosticsByRule: Readonly<Partial<Record<RuleId, number>>>;
  /** Non-deterministic — for human display only. Stripped before hashing. */
  readonly elapsedMs: number;
  readonly cacheHitRate: number;
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
  readonly _meta: {
    readonly version: string;
    readonly mode: AnalysisMode;
    readonly determinismHash: string;
  };
}
