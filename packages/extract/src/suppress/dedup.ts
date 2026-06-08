/**
 * dedup.ts — Phase 3c.6 (T076) — per-file warn-once dedup helper for the
 * suppression parser.
 *
 * Wraps a process-singleton `Set<string>` keyed by `${file}:${kind}:${token}`
 * so that:
 *
 *   - The legacy-alias deprecation warning is emitted at most once per file
 *     even when many legacy-alias ignore comments appear in that file.
 *   - The unknown-token did-you-mean warning is emitted at most once per
 *     `(file, token)` pair so a typo repeated on consecutive lines does not
 *     spam stderr.
 *
 * The dedup state is intentionally process-wide (not request-scoped): the
 * extract package may be invoked many times within a single CLI / LSP run,
 * and re-emitting the same warning per call would be noisy. Tests reset the
 * state via `__resetForTest()` between cases — mirroring the pattern in
 * `wasm/integrity.ts` (`__setManifestForTest`).
 *
 * Determinism (NFR-1): the helper is pure with respect to its arguments
 * (same key → same outcome within a single process). The console-write
 * side-effect is observable via `vi.spyOn(console, 'warn')` in tests.
 */

const seen = new Set<string>();

export type WarnKind = 'legacy' | 'unknown';

/**
 * Emit a warning to `console.warn` exactly once per `(file, kind, token)`
 * tuple. Returns `true` on the call that actually wrote, `false` on every
 * subsequent suppressed call. The return value is exposed for tests; callers
 * normally ignore it.
 */
export function warnOncePerFile(
  file: string,
  kind: WarnKind,
  token: string,
  message: string,
): boolean {
  const key = `${file}:${kind}:${token}`;
  if (seen.has(key)) return false;
  seen.add(key);
  // Unknown-token and did-you-mean diagnostics are emitted to stderr via
  // console.warn per the suppression-parser spec (T076). Tests assert the
  // exact warning text via vi.spyOn(console, 'warn').
  // biome-ignore lint/suspicious/noConsole: user-facing diagnostic, asserted by tests
  console.warn(message);
  return true;
}

/**
 * Test-only escape hatch: clears the per-file warn-once state so each test
 * starts from a clean slate. Mirrors `__setManifestForTest` in
 * `wasm/integrity.ts`. Not re-exported from the package barrel.
 */
export function __resetForTest(): void {
  seen.clear();
}

/** Test-only: number of unique keys recorded. */
export function __sizeForTest(): number {
  return seen.size;
}
