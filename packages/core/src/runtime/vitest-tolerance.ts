/**
 * runtime/vitest-tolerance.ts — Phase 3g Wave B — Vitest column-null pre-flight.
 *
 * Vitest's `coverage-v8` reporter occasionally emits `column: null` on per-range
 * objects (an extra metadata field outside the Inspector contract). The
 * v8-coverage parser tolerates the field (Phase 3e — `parseCoverage`) and
 * never stores it on the resulting `ScriptCoverage`. To preserve a once-per-file
 * diagnostic for users, this Wave B helper walks raw JSON / `CoverageInput`-
 * shaped raw objects and surfaces the offending file name through a callback.
 *
 * Why raw input instead of `ScriptCoverage[]`: by the time the data has been
 * parsed into `CoverageInput`, the column field has already been stripped. The
 * Wave B helper therefore observes the raw payload directly. The companion
 * change in `parseCoverage(json, { onColumnNull })` provides the same hook
 * inline for callers that go through the parse path; this helper is for
 * callers that come in via a pre-parsed JSON object.
 *
 * Verbatim warn message (asserted byte-for-byte by tests):
 *
 *   "runtime-coverage: column field missing or null in <file>; treating as column 0"
 *
 * Determinism (NFR-1): warns are de-duplicated per file via the shared
 * `warnOncePerFile` helper from `@fugazi/extract`.
 */

import { warnOncePerFile } from '@fugazi/extract';

export interface ValidateColumnToleranceOptions {
  /**
   * Optional callback invoked once per offending file. When omitted the helper
   * still emits a `console.warn` via `warnOncePerFile` so the user always sees
   * the diagnostic; supplying a callback lets a host application redirect the
   * notification (e.g. into an LSP diagnostic pump) without losing the once-
   * per-file dedup.
   */
  readonly onWarn?: (file: string) => void;
}

/**
 * Walk a raw coverage JSON object (already `JSON.parse`d) and warn once per
 * file when any range carries `column: null` or is missing the column field
 * entirely after a sibling explicitly emitted `column: null`. The helper
 * never throws — malformed input is silently skipped (the static parser is
 * the canonical validator).
 */
export function validateColumnTolerance(
  rawInput: unknown,
  options: ValidateColumnToleranceOptions = {},
): void {
  if (!isObject(rawInput)) return;
  const result = rawInput.result;
  if (!Array.isArray(result)) return;
  for (const entry of result) {
    if (!isObject(entry)) continue;
    const url = typeof entry.url === 'string' ? entry.url : '';
    if (url === '') continue;
    const functions = entry.functions;
    if (!Array.isArray(functions)) continue;
    if (anyRangeHasNullColumn(functions)) {
      emitWarn(url, options.onWarn);
    }
  }
}

function anyRangeHasNullColumn(functions: readonly unknown[]): boolean {
  for (const fn of functions) {
    if (!isObject(fn)) continue;
    const ranges = fn.ranges;
    if (!Array.isArray(ranges)) continue;
    for (const r of ranges) {
      if (!isObject(r)) continue;
      if (Object.hasOwn(r, 'column') && r.column === null) return true;
    }
  }
  return false;
}

function emitWarn(file: string, onWarn?: (file: string) => void): void {
  const message = `runtime-coverage: column field missing or null in ${file}; treating as column 0`;
  // `warnOncePerFile` keys on `(file, kind, token, message)` and emits to
  // `console.warn` exactly once per file/kind/token tuple. We use kind
  // `'unknown'` so the dedup namespace doesn't collide with the suppression
  // parser's legacy/unknown channels and pass the file as the dedup token.
  const fired = warnOncePerFile(file, 'unknown', 'runtime-column-null', message);
  if (fired && onWarn !== undefined) onWarn(file);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
