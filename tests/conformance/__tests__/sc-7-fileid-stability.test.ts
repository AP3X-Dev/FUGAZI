/**
 * sc-7-fileid-stability.test.ts — Phase 3m T287 — SC-7 acceptance row.
 *
 * SC-7 is the FileId-stability invariant from ADR-004 / PRP FR-D1: the same
 * set of input paths must always yield the same FileId map regardless of the
 * order they were supplied in. This file permutes a synthetic path set across
 * 100 runs and asserts byte-identical output every time.
 *
 * The permutation is seeded from the iteration index (a deterministic
 * Fisher-Yates) so the test itself is reproducible — `Math.random` is
 * forbidden in determinism-related tests per the project's NFR-1 contract.
 */

import { type FileId, assignFileIds } from '@fugazi/types';
import { describe, expect, it } from 'vitest';

const PATHS: readonly string[] = [
  'src/a.ts',
  'src/b.ts',
  'src/c.ts',
  'src/sub/d.ts',
  'src/sub/e.ts',
  'src/sub/nested/f.ts',
  'src/x.ts',
  'src/y.ts',
  'src/z.ts',
  'package.json',
  'tsconfig.json',
  'README.md',
];

/**
 * Deterministic Fisher-Yates using a Linear Congruential Generator seeded
 * from `seed`. Produces a permutation that depends only on `seed` so the
 * test is reproducible run-to-run.
 */
function permute(input: readonly string[], seed: number): string[] {
  const out = [...input];
  // LCG params from Numerical Recipes — these are well-known; nothing
  // statistical hangs on the choice for shuffle quality.
  let state = (seed * 1664525 + 1013904223) >>> 0;
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    const a = out[i] as string;
    const b = out[j] as string;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

function mapToCanonical(map: ReadonlyMap<string, FileId>): string {
  const entries: Array<[string, number]> = [];
  for (const [k, v] of map) {
    entries.push([k, v as unknown as number]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

describe('SC-7: FileId stability under permutation', () => {
  it('byte-identical FileId map across 100 deterministic permutations', () => {
    const baseline = mapToCanonical(assignFileIds(PATHS));
    for (let seed = 1; seed <= 100; seed++) {
      const permuted = permute(PATHS, seed);
      const map = assignFileIds(permuted);
      const canonical = mapToCanonical(map);
      expect(canonical, `permutation seed=${seed} produced different mapping`).toBe(baseline);
    }
  });

  it('the assigned ids are dense 1..n in lexicographic path order', () => {
    const map = assignFileIds(PATHS);
    const sorted = [...PATHS].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (let i = 0; i < sorted.length; i++) {
      const path = sorted[i] as string;
      const id = map.get(path) as unknown as number;
      expect(id).toBe(i + 1);
    }
  });

  it('insertion order matches lexicographic path order (Map iteration discipline)', () => {
    const map = assignFileIds(PATHS);
    const seen: string[] = [];
    for (const [k] of map) seen.push(k);
    const sorted = [...PATHS].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(seen).toEqual(sorted);
  });
});
