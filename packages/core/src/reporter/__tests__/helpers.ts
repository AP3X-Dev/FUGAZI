/**
 * helpers.ts — Phase 3j — reporter test helpers.
 *
 * Shared helpers for emitting + serializing fixtures across the seven format
 * tests. Kept here so each per-format test stays focused on output shape.
 */

import type { DiscriminatedIssue } from '@fugazi/types';
import type { ProgressEvent } from '../../types.js';
import type { Reporter, ReporterMeta } from '../types.js';

/** Drive a reporter through `begin` → `emit` / `emitProgress` → `end`. */
export function runReporter(
  reporter: Reporter,
  meta: ReporterMeta,
  issues: readonly DiscriminatedIssue[],
  events: readonly ProgressEvent[],
): string {
  reporter.begin(meta);
  for (const issue of issues) reporter.emit(issue);
  for (const event of events) reporter.emitProgress(event);
  const out = reporter.end();
  if (typeof out !== 'string') {
    throw new Error(`expected string output, got ${typeof out}`);
  }
  return out;
}

/** Return an issue list shuffled by a deterministic Fisher–Yates with a fixed seed. */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed >>> 0;
  // Mulberry32 PRNG — deterministic and seeded.
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
