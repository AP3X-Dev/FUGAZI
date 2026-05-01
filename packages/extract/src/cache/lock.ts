/**
 * lock.ts — Phase 3c.3 Dispatch B (T060) — `proper-lockfile` cross-process
 * safety wrapper.
 *
 * `withLock(file, fn)` acquires an advisory lock against `file` (a
 * `.lock` directory created by `proper-lockfile` next to the file), runs
 * `fn`, and releases the lock in `finally`. Lock-acquisition failures are
 * surfaced as `FugaziCacheError(code: 'CACHE_LOCK_TIMEOUT')` with the
 * verbatim message contract:
 *
 *     `Failed to acquire cache lock for '<file>' after <retries> retries: <cause.message>`
 *
 * Rationale for `proper-lockfile`:
 *   - Cross-process safe (atomic mkdir as the lock primitive)
 *   - Stale-lock recovery via `stale` timeout (default 30s here)
 *   - Retry-with-backoff via `retries` (default 5 here)
 *   - Battle-tested in the wider Node ecosystem
 *
 * `proper-lockfile.lock(file, ...)` requires the file to exist. The cache
 * dispatcher writes blobs that may not yet exist on disk at lock time, so
 * we ensure the file is touched (`writeFile(..., flag: 'a')`) and the
 * parent directory created before lock acquisition. The internal type
 * surface from `proper-lockfile` is intentionally NOT re-exported — it
 * leaks an external dependency type and the public surface should remain
 * stable across upstream version bumps.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { FugaziCacheError } from '@fugazi/types';
import { lock as acquireLock } from 'proper-lockfile';

const DEFAULT_STALE_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 5;

// Retry backoff parameters tuned for cache-write contention. proper-lockfile
// defaults to minTimeout=1000ms which is excessive for a process-local
// adviory lock; 50ms minimum with 2x exponential backoff (capped at 1000ms)
// resolves typical contention in tens of milliseconds while still bounding
// total wait time at roughly retries × maxTimeout.
const RETRY_MIN_TIMEOUT_MS = 50;
const RETRY_MAX_TIMEOUT_MS = 1_000;
const RETRY_FACTOR = 2;

export interface LockOptions {
  /** Milliseconds after which a held lock is considered stale and may be
   *  forcibly broken by another writer. Defaults to 30 000 ms. */
  readonly staleTimeoutMs?: number;
  /** Number of retry attempts for lock acquisition before raising
   *  CACHE_LOCK_TIMEOUT. Defaults to 5. */
  readonly retries?: number;
}

/**
 * Ensure `file` exists so `proper-lockfile.lock` can resolve its parent and
 * sibling lockfile path. The append-flag write is a touch — it does NOT
 * truncate or modify content if the file already exists.
 */
async function ensureLockableFile(file: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, '', { flag: 'a' });
}

/**
 * Acquire a cross-process lock on `file`, run `fn`, then release the lock
 * (whether `fn` resolved or rejected). Returns `fn`'s resolved value, or
 * propagates `fn`'s rejection.
 *
 * On lock-acquisition failure (timeout / contention exhausted), throws
 * `FugaziCacheError(CACHE_LOCK_TIMEOUT)` — `fn` is NOT invoked. The cause
 * (proper-lockfile's underlying error) is preserved on `.cause`.
 */
export async function withLock<T>(
  file: string,
  fn: () => Promise<T>,
  opts?: LockOptions,
): Promise<T> {
  const stale = opts?.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;
  const retries = opts?.retries ?? DEFAULT_RETRIES;

  await ensureLockableFile(file);

  let release: () => Promise<void>;
  try {
    release = await acquireLock(file, {
      stale,
      retries: {
        retries,
        factor: RETRY_FACTOR,
        minTimeout: RETRY_MIN_TIMEOUT_MS,
        maxTimeout: RETRY_MAX_TIMEOUT_MS,
      },
      realpath: false,
    });
  } catch (cause) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    throw new FugaziCacheError({
      code: 'CACHE_LOCK_TIMEOUT',
      message: `Failed to acquire cache lock for '${file}' after ${retries} retries: ${causeMsg}`,
      ...(cause instanceof Error ? { cause } : {}),
    });
  }

  try {
    return await fn();
  } finally {
    // Best-effort release. proper-lockfile's release rejects only if the
    // lock was already gone (compromised); swallowing is safe — the lock
    // is by definition no longer held.
    try {
      await release();
    } catch {
      /* lock already released — nothing to do */
    }
  }
}
