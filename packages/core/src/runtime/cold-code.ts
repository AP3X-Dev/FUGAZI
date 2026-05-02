/**
 * runtime/cold-code.ts — Phase 3g Wave A — `findColdCode` detector core.
 *
 * Walks every project file the static graph knows about and either
 *   (a) finds no coverage entry → that path joins `coverageMissing`, OR
 *   (b) finds coverage entries with hit counts at or below `hitThreshold`
 *       (default 0) → each such function is emitted as a `ColdCodeFinding`.
 *
 * Suppression is parameterized: `opts.suppressedFunctions` is a pre-built set
 * of `${file}::${functionName}` keys. Wave A is intentionally agnostic about
 * how that set is built — Wave B's orchestrator parses `// fugazi-cold-allowed`
 * directives via `@fugazi/extract`'s suppression machinery and threads the
 * result here. This separation keeps the detector free of source-text I/O
 * and trivially testable.
 *
 * v1 limitation — line/col deferred to Wave B (matches `findHotPaths`).
 *
 * Determinism (NFR-1, SC-15):
 *   - `coldCode` is sorted by `(file, functionName)` lex-asc.
 *   - `coverageMissing` is sorted lex-asc.
 *   - Both arrays are frozen.
 */

import type { ColdCodeFinding, CoverageIndex, FindColdCodeOptions } from './types.js';

const DEFAULT_HIT_THRESHOLD = 0;

export interface FindColdCodeResult {
  readonly coldCode: readonly ColdCodeFinding[];
  readonly coverageMissing: readonly string[];
}

/**
 * Detect cold code. `modules` is the set of project files the static graph
 * tracks; coverage entries for files not in `modules` are silently ignored
 * (they are typically dependencies / generated code Wave B does not surface).
 */
export function findColdCode(
  coverage: CoverageIndex,
  modules: ReadonlySet<string>,
  opts: FindColdCodeOptions = {},
): FindColdCodeResult {
  const threshold = opts.hitThreshold ?? DEFAULT_HIT_THRESHOLD;
  const suppressed = opts.suppressedFunctions;

  const coldCode: ColdCodeFinding[] = [];
  const coverageMissing: string[] = [];

  for (const path of modules) {
    const fns = coverage.byFile.get(path);
    if (fns === undefined) {
      coverageMissing.push(path);
      continue;
    }
    for (const fn of fns) {
      const hits = sumHits(fn.ranges);
      if (hits > threshold) continue;
      const key = `${path}::${fn.functionName}`;
      if (suppressed?.has(key) === true) continue;
      coldCode.push({
        file: path,
        functionName: fn.functionName,
        hits,
        line: 0,
        col: 0,
      });
    }
  }

  coverageMissing.sort();
  coldCode.sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.functionName !== b.functionName) return a.functionName < b.functionName ? -1 : 1;
    return 0;
  });

  return Object.freeze({
    coldCode: Object.freeze(coldCode) as readonly ColdCodeFinding[],
    coverageMissing: Object.freeze(coverageMissing) as readonly string[],
  });
}

function sumHits(ranges: readonly { readonly count: number }[]): number {
  let total = 0;
  for (const r of ranges) total += r.count;
  return total;
}
