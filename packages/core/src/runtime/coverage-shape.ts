/**
 * runtime/coverage-shape.ts — Phase 3g Wave A — input-shaping helper.
 *
 * Folds a flat `readonly ScriptCoverage[]` into the dual-keyed `CoverageIndex`
 * the detector cores consume. The two views share the same `FunctionCoverage`
 * references — no copying.
 *
 * URL → POSIX path normalization (matches the rebase contract elsewhere in the
 * pipeline so detectors can join against the static graph by raw key):
 *   - `file:///C:/foo.ts`        → `C:/foo.ts`   (Windows file URL form)
 *   - `file:///foo/bar.ts`       → `/foo/bar.ts` (POSIX file URL form)
 *   - `file://host/share/x.ts`   → `/share/x.ts` (UNC stripped to leading `/`)
 *   - `foo.ts`                   → `foo.ts`     (relative URL — passthrough)
 *   - any backslashes            → forward slashes (POSIX form)
 *
 * Anonymous-function disambiguation: V8 emits functionName `''` or
 * `'<anonymous>'` for arrow expressions / IIFEs / class field initializers.
 * Within a single script multiple anonymous functions are common, so the
 * `byFunction` index disambiguates collisions with a `::<i>` suffix in
 * insertion order. Named functions never collide because V8 includes the
 * defining lexical name; if they do, the same suffix scheme applies.
 *
 * Determinism (NFR-1): scripts are processed in input-array order, functions
 * within a script in input-array order. Both `Map`s preserve insertion order.
 * The returned index and its inner arrays are frozen.
 */

import type { FunctionCoverage, ScriptCoverage } from '@fugazi/v8-coverage';
import type { CoverageIndex } from './types.js';

const FILE_SCHEME = 'file://';

/**
 * Build the dual-keyed coverage index from a flat ScriptCoverage list.
 *
 * The `byFunction` index uses `${path}::${functionName}` as the key for the
 * first occurrence; any subsequent collision (same path + same name, common
 * for `<anonymous>`) gets `::<i>` appended where `i` is the 1-based count of
 * prior collisions. This keeps lookups fast (no array scan) and stable across
 * runs given identical input ordering.
 */
export function buildCoverageIndex(scripts: readonly ScriptCoverage[]): CoverageIndex {
  const byFile = new Map<string, FunctionCoverage[]>();
  const byFunction = new Map<string, FunctionCoverage>();
  const collisionCounts = new Map<string, number>();

  for (const script of scripts) {
    const path = urlToPosixPath(script.url);
    let bucket = byFile.get(path);
    if (bucket === undefined) {
      bucket = [];
      byFile.set(path, bucket);
    }

    for (const fn of script.functions) {
      bucket.push(fn);

      const baseKey = `${path}::${fn.functionName}`;
      if (!byFunction.has(baseKey)) {
        byFunction.set(baseKey, fn);
        continue;
      }
      const next = (collisionCounts.get(baseKey) ?? 0) + 1;
      collisionCounts.set(baseKey, next);
      byFunction.set(`${baseKey}::${next}`, fn);
    }
  }

  // Freeze inner arrays so callers cannot mutate the indexed view.
  const frozenByFile = new Map<string, readonly FunctionCoverage[]>();
  for (const [path, fns] of byFile) {
    frozenByFile.set(path, Object.freeze(fns.slice()));
  }

  return Object.freeze({
    byFile: frozenByFile,
    byFunction,
  });
}

/**
 * Normalize a ScriptCoverage URL to a POSIX-style path matching what the rest
 * of the pipeline uses for file keys. See module header for cases handled.
 *
 * The implementation walks the input deterministically — no regex, no
 * `URL` parsing — to keep the behavior transparent and fully covered.
 */
function urlToPosixPath(url: string): string {
  let path = url;
  if (path.startsWith(FILE_SCHEME)) {
    path = path.slice(FILE_SCHEME.length);
    // `file:///C:/foo` → after slice we have `/C:/foo` → strip the leading `/`
    // when it is followed by a drive letter ("X:").
    if (
      path.length >= 3 &&
      path.charCodeAt(0) === SLASH &&
      isDriveLetter(path.charCodeAt(1)) &&
      path.charCodeAt(2) === COLON
    ) {
      path = path.slice(1);
    } else if (path.length > 0 && path.charCodeAt(0) !== SLASH) {
      // `file://host/share` → after slice we have `host/share`. Convert UNC
      // to a leading `/` so consumers can treat it as POSIX-absolute. The
      // host segment is dropped — Fugazi does not preserve hostnames.
      const slashIdx = path.indexOf('/');
      path = slashIdx === -1 ? `/${path}` : path.slice(slashIdx);
    }
  }
  if (path.includes('\\')) path = path.replace(/\\/g, '/');
  return path;
}

const SLASH = '/'.charCodeAt(0);
const COLON = ':'.charCodeAt(0);
const A_UPPER = 'A'.charCodeAt(0);
const Z_UPPER = 'Z'.charCodeAt(0);
const A_LOWER = 'a'.charCodeAt(0);
const Z_LOWER = 'z'.charCodeAt(0);

function isDriveLetter(code: number): boolean {
  return (code >= A_UPPER && code <= Z_UPPER) || (code >= A_LOWER && code <= Z_LOWER);
}
