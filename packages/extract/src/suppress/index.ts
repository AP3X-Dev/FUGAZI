/**
 * index.ts — Phase 4a T308 — suppression-parser dispatch barrel.
 *
 * Routes by file extension: `.py` → `parseSuppressionsPy` (Python `#`
 * comments), everything else → `parseSuppressions` (TS/JS `//` comments).
 *
 * Both implementations return the same `Suppression[]` shape, so the
 * dispatcher is transparent to callers. Re-exports the supporting types
 * (`Suppression`) and the warn-once dedup helper for callers that need to
 * reset the singleton state in tests.
 */

import { parseSuppressionsPy } from './parse-py.js';
import { parseSuppressions } from './parse.js';
import type { Suppression } from './parse.js';

export type { Suppression } from './parse.js';
export { parseSuppressions } from './parse.js';
export { parseSuppressionsPy } from './parse-py.js';
export { __resetForTest, __sizeForTest, warnOncePerFile } from './dedup.js';
export type { WarnKind } from './dedup.js';

/**
 * Parse suppression directives from `source`, dispatching to the
 * language-specific implementation by `filename` extension. Files ending in
 * `.py` (case-insensitive) route to the Python parser; everything else
 * routes to the TS/JS parser.
 */
export function parseSuppressionsByLang(source: string, filename: string): readonly Suppression[] {
  return isPythonFile(filename)
    ? parseSuppressionsPy(source, filename)
    : parseSuppressions(source, filename);
}

function isPythonFile(filename: string): boolean {
  // Match `.py` and `.pyi` (stub files). Case-insensitive — Windows users
  // sometimes have `.PY` files; match the de-facto convention.
  const lower = filename.toLowerCase();
  return lower.endsWith('.py') || lower.endsWith('.pyi');
}
