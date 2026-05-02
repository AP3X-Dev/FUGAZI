/**
 * types.ts — Phase 3e (T108) — V8 / Inspector ScriptCoverage shapes.
 *
 * Mirrors the Inspector protocol verbatim. These shapes are the lingua franca
 * of `node --experimental-test-coverage`, `c8`, the Inspector's
 * `Profiler.takePreciseCoverage`, and Vitest's `coverage-v8` reporter. We
 * accept all variants that share this top-level shape; per-field tolerance is
 * documented inline.
 */

export interface CoverageRange {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly count: number;
}

export interface FunctionCoverage {
  readonly functionName: string;
  readonly ranges: readonly CoverageRange[];
  readonly isBlockCoverage: boolean;
}

export interface ScriptCoverage {
  readonly scriptId: string;
  readonly url: string;
  readonly functions: readonly FunctionCoverage[];
}

/**
 * Top-level coverage input. Both Node `--experimental-test-coverage` JSON and
 * Vitest `coverage-v8` JSON share `{ result: ScriptCoverage[] }` at the top.
 * `timestamp` and `source-map-cache` are tolerated and ignored.
 */
export interface CoverageInput {
  readonly result: readonly ScriptCoverage[];
  readonly timestamp?: number;
  readonly 'source-map-cache'?: unknown;
}
