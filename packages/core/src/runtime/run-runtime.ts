/**
 * runtime/run-runtime.ts — Phase 3g Wave B — runtime-intelligence entry point.
 *
 * Composes the Wave A detector cores into a single, never-throws (modulo the
 * explicit `COVERAGE_REBASE_AMBIGUOUS`) function. Pipeline:
 *
 *   1. rebase     — explicit-or-auto via `rebaseCoverageAuto`.
 *   2. column     — pre-flight: walk raw input for `column: null` (informational).
 *   3. index      — `buildCoverageIndex` over the rebased scripts.
 *   4. hot-path   — `findHotPaths` (top-N% by aggregate hits).
 *   5. cold-code  — `findColdCode` (functions <= hitThreshold + missing files).
 *   6. weighted   — per-file weighted score + top-K refactor targets.
 *   7. assemble   — frozen `RuntimeReport`.
 *
 * v1 limitation — line/col deferred:
 *   Findings carry `line: 0, col: 0`. Source-text-aware conversion via
 *   `buildOffsetMap` is the responsibility of downstream consumers (CLI, LSP,
 *   reporter) which already have the source loaded. Doing the lookup here
 *   would require an extra full-project read pass and is left to Phase 3h.
 *
 * Determinism (NFR-1 / SC-15): every list is sorted at construction time and
 * the returned report is deeply frozen.
 */

import type { FileComplexity } from '@fugazi/extract';
import type { CoverageInput } from '@fugazi/v8-coverage';
import type { HealthScore, RefactorTarget } from '../health/types.js';
import { findColdCode } from './cold-code.js';
import { type RebaseMode, rebaseCoverageAuto } from './coverage-rebase.js';
import { buildCoverageIndex } from './coverage-shape.js';
import { findHotPaths } from './hot-path.js';
import { type RuntimeReport, emptyRuntimeReport } from './runtime-report.js';
import type {
  ColdCodeFinding,
  CoverageIndex,
  FindColdCodeOptions,
  FindHotPathsOptions,
  HotPathFinding,
} from './types.js';
import { validateColumnTolerance } from './vitest-tolerance.js';
import { computeWeightedFileScore } from './weighted-health.js';

/** Default `K` for the weighted-refactor-targets list. */
const DEFAULT_TOP_K = 10;

export interface RunRuntimeOptions {
  readonly coverage: CoverageInput;
  /** Static-graph file paths (absolute POSIX). Used for cold-code module enumeration. */
  readonly modules: ReadonlySet<string>;
  /** Per-file complexity keyed by absolute POSIX path. */
  readonly complexityByPath: ReadonlyMap<string, FileComplexity>;
  readonly projectRoot: string;
  /** Explicit `{ from, to }` or `'auto'`. Omit to skip rebase. */
  readonly coverageRoot?: RebaseMode;
  readonly hotPathOptions?: FindHotPathsOptions;
  readonly coldCodeOptions?: FindColdCodeOptions;
  /** Pre-built suppression set (from `// fugazi-cold-allowed` directives). */
  readonly suppressedFunctions?: ReadonlySet<string>;
  /** Per-file callback fired once per file emitting `column: null`. */
  readonly onColumnNull?: (file: string) => void;
  /** Top-K weighted refactor targets to surface. Default 10. */
  readonly topK?: number;
}

/**
 * Run the runtime-intelligence pipeline. Returns a frozen `RuntimeReport`.
 * Synchronous: never returns a Promise. Throws only on
 * `COVERAGE_REBASE_AMBIGUOUS` (auto-detection cannot find an unambiguous
 * mapping); every other failure mode degrades to an empty / partial report.
 */
export function runRuntime(opts: RunRuntimeOptions): RuntimeReport {
  // Step 1: rebase (explicit/auto/skip).
  const inputScripts = opts.coverage.result;
  const rebased =
    opts.coverageRoot !== undefined
      ? rebaseCoverageAuto(inputScripts, {
          mode: opts.coverageRoot,
          projectRoot: opts.projectRoot,
          modules: opts.modules,
        })
      : inputScripts;

  // Step 2: column-null pre-flight (informational; never throws).
  validateColumnTolerance(opts.coverage, {
    ...(opts.onColumnNull !== undefined ? { onWarn: opts.onColumnNull } : {}),
  });

  // Step 3: build the coverage index.
  const index: CoverageIndex = buildCoverageIndex(rebased);

  // Empty pipeline → frozen empty report.
  if (index.byFile.size === 0 && opts.modules.size === 0) {
    return emptyRuntimeReport();
  }

  // Step 4: hot paths.
  const hotPaths: readonly HotPathFinding[] = findHotPaths(index, opts.hotPathOptions ?? {});

  // Step 5: cold code + coverage-missing.
  const coldOpts: FindColdCodeOptions = {
    ...(opts.coldCodeOptions ?? {}),
    ...(opts.suppressedFunctions !== undefined
      ? { suppressedFunctions: opts.suppressedFunctions }
      : {}),
  };
  const coldResult = findColdCode(index, opts.modules, coldOpts);
  const coldCode: readonly ColdCodeFinding[] = coldResult.coldCode;
  const coverageMissing: readonly string[] = coldResult.coverageMissing;

  // Step 6: weighted refactor targets.
  const weightedRefactorTargets = computeWeightedTargets(
    opts.modules,
    opts.complexityByPath,
    index,
    opts.topK ?? DEFAULT_TOP_K,
  );

  return Object.freeze({
    schemaVersion: 1,
    hotPaths,
    coldCode,
    coverageMissing,
    weightedRefactorTargets,
  }) satisfies RuntimeReport;
}

function computeWeightedTargets(
  modules: ReadonlySet<string>,
  complexityByPath: ReadonlyMap<string, FileComplexity>,
  coverage: CoverageIndex,
  k: number,
): readonly RefactorTarget[] {
  if (k <= 0) return Object.freeze([]);
  const perFile = new Map<string, HealthScore>();
  for (const path of modules) {
    const fc = complexityByPath.get(path);
    if (fc === undefined) continue;
    const score = computeWeightedFileScore(fc, coverage, path);
    perFile.set(
      path,
      Object.freeze({
        file: path,
        score,
        cyclomatic: fc.aggregate.cyclomatic,
        cognitive: fc.aggregate.cognitive,
        maintainabilityIndex: fc.aggregate.maintainabilityIndex,
      }),
    );
  }
  const arr: RefactorTarget[] = [];
  for (const score of perFile.values()) {
    arr.push(Object.freeze({ file: score.file, score: score.score }));
  }
  arr.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    return 0;
  });
  return Object.freeze(arr.slice(0, k));
}
