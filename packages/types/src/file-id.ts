/**
 * FileId — a branded, immutable integer identifier for a source file in the
 * project graph. Branding prevents accidental mixing with raw numbers.
 *
 * Per ADR-004:
 *   - Ids are assigned in lexicographic path order, so the same set of paths
 *     always yields the same id for each path regardless of input order.
 *   - Id 0 is reserved as ROOT_FILE_ID (project-root sentinel); real files
 *     start at 1.
 *   - Ids are dense (1..n) within a single project state and intended to
 *     index packed arrays, NOT to survive across runs.
 *
 * Per PRP FR-D1 + SC-7 the assignment function MUST be stable under input
 * permutation; per FR-D3 the returned Map iterates in insertion order, which
 * we deliberately make lexicographic.
 *
 * The brand uses a unique-symbol nominal type. The `as unknown as FileId`
 * double-cast applied at construction is the single permitted unsafe boundary.
 */
declare const fileIdBrand: unique symbol;
export type FileId = number & { readonly [fileIdBrand]: never };

/**
 * Project-root sentinel id. Always 0; never assigned to a real file.
 */
export const ROOT_FILE_ID: FileId = 0 as unknown as FileId;

/**
 * Assign FileIds to a set of paths.
 *
 * The input is sorted lexicographically using a bare comparator
 * (`a < b ? -1 : a > b ? 1 : 0`) — NOT `localeCompare`, which is locale-
 * dependent and would break determinism across locales (NFR-1, SC-15).
 *
 * The returned ReadonlyMap has insertion order equal to the sorted path
 * order, satisfying FR-D3 (Map insertion-order discipline).
 *
 * The input array is NOT mutated; we copy via `[...paths]` before sorting.
 *
 * No `Math.random`, no `Date.now`, no IO — fully deterministic.
 *
 * @param paths Source file paths (typically already canonicalized).
 * @returns A `ReadonlyMap` from path to its assigned FileId, ids running
 *          contiguously from 1 to `paths.length` in lexicographic order.
 */
export function assignFileIds(paths: readonly string[]): ReadonlyMap<string, FileId> {
  const sorted = [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const map = new Map<string, FileId>();
  for (let i = 0; i < sorted.length; i++) {
    const path = sorted[i] as string;
    const id = (i + 1) as unknown as FileId;
    map.set(path, id);
  }
  return map;
}

/**
 * Compare two FileIds numerically, suitable for `Array.prototype.sort`.
 *
 * Returns a negative number if `a < b`, a positive number if `a > b`, and 0
 * if equal. Uses subtraction (safe because FileIds are small non-negative
 * integers, never near `Number.MAX_SAFE_INTEGER`).
 */
export function compareFileIds(a: FileId, b: FileId): number {
  return (a as unknown as number) - (b as unknown as number);
}
