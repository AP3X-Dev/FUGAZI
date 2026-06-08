/**
 * git-toplevel.ts — Phase 3d.6 (T106) — process-singleton git toplevel resolver.
 *
 * `getGitToplevel(cwd)` returns the canonical absolute path of the git
 * repository containing `cwd`, by spawning `git rev-parse --show-toplevel`
 * once per unique key and caching the resulting Promise. Per IMP-PERF-05:
 * only ONE rev-parse per root regardless of call count, even when many
 * concurrent callers race for the same key — they all await the same
 * in-flight Promise.
 *
 * Cache shape: `Map<string, Promise<string>>` where the key is BOTH:
 *   - the input `cwd` (so a repeated call from the same subdirectory hits)
 *   - AND the resolved canonical toplevel itself (so a subsequent call from
 *     any other subdirectory of the same repo lands on the same cache entry
 *     once one call has been resolved — cf. IMP-PERF-05 sub-bullet about
 *     "any subdirectory of the same repo").
 *
 * Rejected promises stay in the cache: a failure is memoized as a rejected
 * Promise, so callers receive the same rejection without re-spawning git on a
 * known-broken repo.
 *
 * Errors wrap as `FugaziGraphError({ code: 'GIT_TOPLEVEL_FAILED' })` with the
 * verbatim message
 *   `git rev-parse --show-toplevel failed for <cwd>: <stderr>`
 * where `<stderr>` is the trimmed git stderr text or the literal
 * `<no stderr>` when stderr is empty.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { FugaziGraphError, canonicalize } from '@fugazi/types';

// Lazily-bound process-wide cache. The Promise itself is shared so concurrent
// callers before the first resolve await the same shell-out.
let cache: Map<string, Promise<string>> = new Map();

// `promisify(exec)` returns the standard { stdout, stderr } envelope. We keep
// it module-scoped (not per-call) so test mocks of `node:child_process` still
// flow through cleanly — vitest's `vi.mock('node:child_process', ...)` swaps
// the module record, and our `promisify(exec)` resolves against the mocked
// `exec` because it is invoked at call time.
const execP = promisify(exec);

// Internal: spawn `git rev-parse --show-toplevel` in `cwd`, parse, canonicalize.
async function spawnGitToplevel(cwd: string): Promise<string> {
  let stdout: string;
  let stderr: string;
  try {
    const result = await execP('git rev-parse --show-toplevel', { cwd });
    stdout = String(result.stdout ?? '');
    stderr = String(result.stderr ?? '');
  } catch (cause) {
    // exec rejects on non-zero exit. The thrown object carries `.stderr`.
    const stderrRaw =
      cause && typeof cause === 'object' && 'stderr' in cause
        ? String((cause as { stderr?: unknown }).stderr ?? '')
        : '';
    const trimmedStderr = stderrRaw.trim();
    const stderrText = trimmedStderr.length === 0 ? '<no stderr>' : trimmedStderr;
    throw new FugaziGraphError({
      code: 'GIT_TOPLEVEL_FAILED',
      message: `git rev-parse --show-toplevel failed for ${cwd}: ${stderrText}`,
      ...(cause instanceof Error ? { cause } : {}),
    });
  }

  void stderr; // success path: stderr is informational, we ignore it.
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    throw new FugaziGraphError({
      code: 'GIT_TOPLEVEL_FAILED',
      message: `git rev-parse --show-toplevel failed for ${cwd}: <no stderr>`,
    });
  }

  // Canonicalize so paths agree with the rest of the pipeline regardless of
  // platform quirks (macOS /tmp -> /private/tmp, Windows 8.3 short paths,
  // verbatim \\?\ prefix, drive-letter casing).
  return canonicalize(trimmed);
}

/**
 * Lazily resolves and caches the canonical git toplevel for any working
 * directory under the same repo. Per IMP-PERF-05: only ONE `git rev-parse`
 * per root regardless of call count. The Promise itself is shared.
 *
 * On success, the resolved toplevel is also stored under its canonical-path
 * key so that subsequent calls from a different subdirectory of the same
 * repo can short-circuit. (The shortcut applies only AFTER at least one
 * call has resolved — the first call from any new `cwd` still spawns git.)
 *
 * @throws FugaziGraphError({ code: 'GIT_TOPLEVEL_FAILED' }) if git rev-parse
 *   fails or the directory is not inside a git repository.
 */
export async function getGitToplevel(cwd: string): Promise<string> {
  const cached = cache.get(cwd);
  if (cached !== undefined) {
    return cached;
  }
  const promise = spawnGitToplevel(cwd);
  cache.set(cwd, promise);
  // Cross-link under the canonical toplevel itself, but only on success.
  // Failures are still cached against `cwd` so we don't re-spawn git on a
  // broken repo, but we don't want to poison the canonical-toplevel slot.
  promise.then(
    (toplevel) => {
      if (!cache.has(toplevel)) {
        cache.set(toplevel, promise);
      }
    },
    () => {
      // Rejection: leave the entry under `cwd` so subsequent lookups from
      // the same broken cwd get the same rejection.
    },
  );
  return promise;
}

/**
 * Test-only: drop every cached git-toplevel entry. Vitest tests that swap
 * `node:child_process` mocks across cases must call this in `beforeEach` so
 * the cache from a previous case does not bleed into the next.
 */
export function __resetGitToplevelCacheForTest(): void {
  cache = new Map();
}
