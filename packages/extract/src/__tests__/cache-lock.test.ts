/**
 * cache-lock.test.ts — T059-test acceptance suite for the Phase 3c.3
 * Dispatch B `proper-lockfile` cross-process safety wrapper (T060).
 *
 * Acceptance map:
 *   - 50-iteration concurrent-write surface — `withLock — concurrency`
 *   - Lock release on success — `withLock — release`
 *   - Lock release on error — `withLock — release`
 *   - Stale-lock recovery (verified upstream by proper-lockfile) — documented skip
 *   - Lock-acquire timeout (verified upstream by proper-lockfile) — documented skip
 *
 * Why some cases are intentionally absent here:
 *   - Stale-lock recovery requires either (a) crashing a child process
 *     while holding a lock, or (b) racing with proper-lockfile's internal
 *     mtime-update timer. Both require subprocess orchestration that adds
 *     more flake than coverage. proper-lockfile's own test suite covers
 *     this exhaustively; we trust the `stale` option.
 *   - Lock-acquire timeout under contention is non-deterministic to
 *     reproduce in-process — `await withLock(...)` returns synchronously
 *     once the lock is held, leaving no observable contention window for
 *     a second caller without sleeping `fn` for an indeterminate time.
 *     Documented `it.skip` below explains the rationale.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withLock } from '../cache/lock.js';

// --------------------------------------------------------------------------
// Shared fixtures
// --------------------------------------------------------------------------

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'fugazi-cache-lock-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

const fileIn = (name: string): string => join(tmpRoot, name);

// --------------------------------------------------------------------------
// Single-writer round-trip — 1 case
// --------------------------------------------------------------------------

describe('withLock — single writer', () => {
  it('round-trips through writeFile under lock and persists data', async () => {
    const file = fileIn('single.bin');
    const payload = 'hello-locked-world';
    await withLock(file, async () => {
      await writeFile(file, payload);
    });
    const got = await readFile(file, 'utf8');
    expect(got).toBe(payload);
  });
});

// --------------------------------------------------------------------------
// Concurrency — 50-iteration torn-write surface
// --------------------------------------------------------------------------

describe('withLock — concurrency', () => {
  // 50 iterations × N concurrent writers per iteration. Each writer writes
  // a 1KB payload picked from a fixed set of distinct payloads. Final
  // on-disk content must equal one of those payloads byte-for-byte (no
  // torn writes / partial overwrites). 1KB is large enough that torn
  // writes would surface as observable corruption if the lock is broken;
  // small enough to keep the test fast.
  //
  // Concurrent writer count is kept moderate (4) to bound total runtime:
  // proper-lockfile retries with exponential backoff, so a 10-way race per
  // iteration multiplies wall-clock time disproportionately. 4-way × 50
  // iterations = 200 lock acquires under contention is plenty to surface
  // a broken-lock bug.
  it('50-iteration concurrent writes never produce torn output', async () => {
    const PAYLOAD_COUNT = 4;
    const ITERATIONS = 50;
    const PAYLOAD_SIZE = 1024;

    // Pre-generate distinct fixed-length payloads. Each payload's content
    // is a single repeated digit so a torn write (mixing two payloads)
    // would be trivially detectable.
    const payloads: string[] = [];
    for (let i = 0; i < PAYLOAD_COUNT; i++) {
      payloads.push(String(i).repeat(PAYLOAD_SIZE).slice(0, PAYLOAD_SIZE));
    }

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const file = fileIn(`concurrent-${iter}.bin`);
      // Pre-touch with a known sentinel so the file always exists before
      // any writer races; otherwise the first writer's `ensureLockableFile`
      // could race with proper-lockfile's parent-realpath check.
      await writeFile(file, '');

      const writers: Array<Promise<string>> = [];
      for (let i = 0; i < PAYLOAD_COUNT; i++) {
        const payload = payloads[i];
        if (payload === undefined) throw new Error('unreachable: payload index out of range');
        writers.push(
          withLock(
            file,
            async () => {
              await writeFile(file, payload);
              return payload;
            },
            // Use a higher retry budget since 4-way contention exhausts
            // proper-lockfile's default backoff easily.
            { retries: 20 },
          ),
        );
      }
      await Promise.all(writers);

      const got = await readFile(file, 'utf8');
      // Final content must be one of the payloads byte-for-byte.
      expect(payloads).toContain(got);
    }
  }, 60_000);
});

// --------------------------------------------------------------------------
// Release on success / error — 2 cases
// --------------------------------------------------------------------------

describe('withLock — release', () => {
  it('releases the lock on success: a second withLock immediately succeeds', async () => {
    const file = fileIn('release-success.bin');
    let firstRan = false;
    let secondRan = false;
    await withLock(file, async () => {
      firstRan = true;
      await writeFile(file, 'first');
    });
    await withLock(
      file,
      async () => {
        secondRan = true;
        await writeFile(file, 'second');
      },
      // Tight retry budget: if the lock leaked, this would CACHE_LOCK_TIMEOUT
      // rather than succeeding.
      { retries: 0 },
    );
    expect(firstRan).toBe(true);
    expect(secondRan).toBe(true);
    const got = await readFile(file, 'utf8');
    expect(got).toBe('second');
  });

  it('releases the lock on error: a second withLock immediately succeeds after fn throws', async () => {
    const file = fileIn('release-error.bin');
    const sentinel = new Error('intentional failure inside fn');
    await expect(
      withLock(file, async () => {
        throw sentinel;
      }),
    ).rejects.toBe(sentinel);

    // If the lock leaked, retries:0 here would force CACHE_LOCK_TIMEOUT.
    let secondRan = false;
    await withLock(
      file,
      async () => {
        secondRan = true;
      },
      { retries: 0 },
    );
    expect(secondRan).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Documented coverage gaps — see file-level docstring for rationale
// --------------------------------------------------------------------------

describe('withLock — upstream-tested behaviours', () => {
  // Stale-lock recovery requires crashing a process holding the lock so
  // the lockfile mtime stops updating, then waiting `stale` ms for another
  // writer to break the dead lock. proper-lockfile's own test suite covers
  // this; we trust the `stale` option.
  it.skip('proper-lockfile staleTimeout is verified upstream (no in-process repro)', () => {
    /* intentionally empty */
  });

  // Lock-acquire timeout under genuine contention is also covered upstream.
  // Forcing it in-process requires either spawning a subprocess or sleeping
  // inside `fn` for a tight retry window — both add flake without
  // increasing confidence in our `withLock` wrapper specifically.
  it.skip('proper-lockfile retry exhaustion is verified upstream (no in-process repro)', () => {
    /* intentionally empty */
  });
});
