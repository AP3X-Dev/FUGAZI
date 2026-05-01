/**
 * Deterministic sort helpers used across reporters and analyses.
 *
 * Each helper returns a new array (input is never mutated) and uses a bare
 * lexicographic comparator — `a < b ? -1 : a > b ? 1 : 0` — for paths.
 * `localeCompare` and any Intl-aware ordering are explicitly avoided because
 * locale-dependent collation breaks determinism across machines (NFR-1, SC-15).
 *
 * The same path comparator is used by `assignFileIds` (file-id.ts) so file-id
 * order and emit order match.
 */
import type { FileId } from './file-id.js';

/**
 * Return a copy of `items` sorted lexicographically by `path`.
 *
 * The input array is not mutated — `[...items].sort(...)` creates a copy.
 */
export function byPath<T extends { readonly path: string }>(items: readonly T[]): readonly T[] {
  return [...items].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Return a copy of `items` sorted by numeric FileId (ascending).
 *
 * FileIds are small non-negative integers (assigned 1..n by `assignFileIds`),
 * so subtraction is safe and avoids the overflow risk that would apply to
 * arbitrary Number ranges.
 */
export function byFileId<T extends { readonly fileId: FileId }>(items: readonly T[]): readonly T[] {
  return [...items].sort(
    (a, b) => (a.fileId as unknown as number) - (b.fileId as unknown as number),
  );
}

/**
 * Return a copy of `items` sorted by `path` first, then `line` (ascending).
 *
 * Used by reporters (FR-I1) so diagnostics emit in deterministic file → line
 * order independent of the order issues were discovered.
 */
export function byPathThenLine<T extends { readonly path: string; readonly line: number }>(
  items: readonly T[],
): readonly T[] {
  return [...items].sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.line - b.line;
  });
}
