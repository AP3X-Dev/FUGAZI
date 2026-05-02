/**
 * dupes/find-clones.ts — Phase 3f.4 Wave B.
 *
 * Unified clone-detection dispatcher. Runs every enabled clone class
 * (`1 | 2 | 3 | 4`), merges the families, applies subsumption, and returns a
 * deterministically-sorted array.
 *
 * Subsumption: for any pair of families A and B, if every occurrence of A is
 * geographically contained within (or equal to) some occurrence of B and
 * |A| ≤ |B|, drop A. We additionally prefer the more specific match when token
 * lengths are equal:
 *
 *   Type-1  ≻  Type-2  ≻  Type-3  ≻  Type-4
 *
 * "More specific wins" because a Type-1 family proves an exact textual match,
 * which is strictly stronger evidence than a Type-2 family that proves only
 * structural equivalence. When the same code is reported by multiple classes,
 * we want users to see the strongest classification.
 *
 * Sort: same as Wave A's Type-1 — `(-tokenLength, first-occurrence (file, tokenStart))`.
 */

import { findType1Clones } from './type1.js';
import {
  type FindType3Options,
  findType2Clones,
  findType3Clones,
  findType4Clones,
} from './type234.js';
import type { CloneFamily, CloneOccurrence, TokenStream } from './types.js';

export interface FindAllClonesOptions extends FindType3Options {
  readonly enabledTypes?: readonly (1 | 2 | 3 | 4)[];
}

const DEFAULT_ENABLED_TYPES: readonly (1 | 2 | 3 | 4)[] = Object.freeze([1, 2, 3, 4]);

/**
 * `findAllClones` — entry point. Runs every clone-type detector enabled in
 * `opts.enabledTypes` (default: all four), merges the families, applies
 * subsumption, returns sorted output.
 */
export function findAllClones(
  streams: readonly TokenStream[],
  opts?: FindAllClonesOptions,
): readonly CloneFamily[] {
  if (streams.length === 0) return Object.freeze([]);

  const enabledTypes = opts?.enabledTypes ?? DEFAULT_ENABLED_TYPES;
  const enabled = new Set(enabledTypes);
  const all: CloneFamily[] = [];

  const baseOpts: { minTokens?: number } = {};
  if (opts?.minTokens !== undefined) baseOpts.minTokens = opts.minTokens;

  if (enabled.has(1)) {
    for (const f of findType1Clones(streams, baseOpts)) all.push(f);
  }
  if (enabled.has(2)) {
    for (const f of findType2Clones(streams, baseOpts)) all.push(f);
  }
  if (enabled.has(3)) {
    const t3 = findType3Clones(streams, opts);
    for (const f of t3) all.push(f);
  }
  if (enabled.has(4)) {
    for (const f of findType4Clones(streams, baseOpts)) all.push(f);
  }

  const merged = applySubsumption(all);

  merged.sort((a, b) => {
    if (a.tokenLength !== b.tokenLength) return b.tokenLength - a.tokenLength;
    const fa = a.occurrences[0];
    const fb = b.occurrences[0];
    if (fa === undefined || fb === undefined) return 0;
    if (fa.file < fb.file) return -1;
    if (fa.file > fb.file) return 1;
    if (fa.tokenStart !== fb.tokenStart) return fa.tokenStart - fb.tokenStart;
    return kindRank(a.kind) - kindRank(b.kind);
  });

  return Object.freeze(merged);
}

/* -------------------------------------------------------------------------- */
/* Subsumption                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Drop family A if a stronger family B exists where:
 *   - |A.tokenLength| ≤ |B.tokenLength|, AND
 *   - every occurrence of A is contained within (or equal to) some occurrence
 *     of B (same file, byteRange ⊆ byteRange), AND
 *   - if lengths are equal: kindRank(A) > kindRank(B) (B is the more specific
 *     class — Type-1 wins over Type-2 etc).
 */
function applySubsumption(families: readonly CloneFamily[]): CloneFamily[] {
  const drop = new Set<number>();
  for (let i = 0; i < families.length; i++) {
    if (drop.has(i)) continue;
    const a = families[i];
    if (a === undefined) continue;
    for (let j = 0; j < families.length; j++) {
      if (i === j || drop.has(j)) continue;
      const b = families[j];
      if (b === undefined) continue;
      if (subsumes(b, a)) {
        drop.add(i);
        break;
      }
    }
  }
  const out: CloneFamily[] = [];
  for (let i = 0; i < families.length; i++) {
    if (drop.has(i)) continue;
    const f = families[i];
    if (f !== undefined) out.push(f);
  }
  return out;
}

/**
 * `subsumes(b, a)` — does B subsume A?
 *
 *   - B's tokenLength ≥ A's, AND
 *   - every occurrence of A is contained within some occurrence of B, AND
 *   - if equal lengths: kindRank(B) ≤ kindRank(A) (B is at least as specific).
 *   - if equal lengths AND equal kindRank: B is not the same family — break
 *     ties by checking that B is at a strictly earlier position in the list.
 *     (Tested via the caller: i ≠ j and we loop both directions, so the
 *     stricter family wins; if completely identical we keep just one.)
 */
function subsumes(b: CloneFamily, a: CloneFamily): boolean {
  if (a.tokenLength > b.tokenLength) return false;
  if (a.tokenLength === b.tokenLength) {
    const ra = kindRank(a.kind);
    const rb = kindRank(b.kind);
    if (rb > ra) return false;
    if (rb === ra) {
      // Identical token length and kind — only subsume if A's occurrence set
      // is a strict subset of B's, or they're truly equivalent and we want to
      // keep one (we use canonical ordering via `firstOccurrenceKey`).
      const aKey = firstOccurrenceKey(a);
      const bKey = firstOccurrenceKey(b);
      if (aKey === bKey) return false;
      // Otherwise allow subsumption only if every A occurrence is contained.
    }
  }
  for (const occA of a.occurrences) {
    let contained = false;
    for (const occB of b.occurrences) {
      if (occA.file !== occB.file) continue;
      if (
        occA.byteRange.start >= occB.byteRange.start &&
        occA.byteRange.end <= occB.byteRange.end
      ) {
        contained = true;
        break;
      }
    }
    if (!contained) return false;
  }
  return true;
}

function kindRank(kind: CloneFamily['kind']): number {
  switch (kind) {
    case 'type-1':
      return 1;
    case 'type-2':
      return 2;
    case 'type-3':
      return 3;
    case 'type-4':
      return 4;
  }
}

function firstOccurrenceKey(family: CloneFamily): string {
  const occ: CloneOccurrence | undefined = family.occurrences[0];
  if (occ === undefined) return '';
  return `${occ.file}\x00${occ.tokenStart}\x00${occ.tokenEnd}`;
}
