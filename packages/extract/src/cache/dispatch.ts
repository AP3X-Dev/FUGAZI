/**
 * dispatch.ts — Phase 3c.3 Dispatch B (T058) — fast/slow/cold path
 * dispatcher for the parse cache.
 *
 * `getCacheable(filePath, opts)` is the single entry point an orchestrator
 * calls per discovered source file. It returns `{ result, source, hit }`
 * where `hit` is one of:
 *
 *   - `'fast'`  : cache HIT, validated by mtime+size only. Default path.
 *                 Fast path always reads file content from disk because
 *                 downstream phases (graph, dead-code) need the source
 *                 alongside the cached AST. The "fast" win is in skipping
 *                 the parse step, not in skipping disk I/O.
 *   - `'slow'`  : cache HIT, validated by mtime+size AND xxh3 of source.
 *                 Opt-in via `FUGAZI_CACHE_STRICT=1`. Catches
 *                 touch-without-modify and same-size content edits.
 *   - `'cold'`  : cache MISS or any verification mismatch. Read source,
 *                 parse via `scanFile`, compute xxh3, persist atomically
 *                 under `withLock`.
 *
 * Env policy (SC-18): only `FUGAZI_CACHE_STRICT` is read. No other env
 * vars are consulted. Forbidden-env scanner enforces this.
 *
 * Verification ordering for a non-null cache hit:
 *   1. mtime+size match → fast path (return immediately) UNLESS strict.
 *   2. (strict only OR cold rebuild needed) read source.
 *   3. xxh3 match → slow path.
 *   4. mismatch (xxh3 differs OR mtime/size differ outright) → cold path.
 *
 * Cold-path writes go through `withLock(blobPath, ...)` to prevent torn
 * blobs across concurrent workers (T059-test).
 */

import { readFile, stat } from 'node:fs/promises';
import { scanFile } from '../parsers/scan.js';
import { xxh3 } from './hash.js';
import { withLock } from './lock.js';
import { blobPathFor, deriveKey, read, write } from './store.js';
import type { ParseCacheStore } from './store.js';
import type { CacheEntry, CacheableResult } from './types.js';

export interface DispatchOptions {
  /** Cache root directory; the dispatcher stores under `<cacheDir>/parse/`. */
  readonly cacheDir: string;
  /** Stable identifier for the parser engine (e.g. `'swc-wasm'`). */
  readonly parserId: string;
  /** Engine version string — change invalidates all entries deterministically. */
  readonly parserVersion: string;
}

/**
 * Tri-state classification for a cache entry given fresh stat output. Used
 * internally to keep the main flow readable.
 */
type FastPathDecision =
  | { readonly outcome: 'fast'; readonly entry: CacheEntry }
  | { readonly outcome: 'needs-slow' }
  | { readonly outcome: 'cold' };

function classifyByStat(
  cached: CacheEntry | null,
  mtimeMs: number,
  size: number,
  strict: boolean,
): FastPathDecision {
  if (cached === null) return { outcome: 'cold' };
  if (cached.meta.mtimeMs !== mtimeMs || cached.meta.size !== size) {
    return { outcome: 'cold' };
  }
  return strict ? { outcome: 'needs-slow' } : { outcome: 'fast', entry: cached };
}

/**
 * Single-file fast/slow/cold path resolver. See file-level docstring for
 * full semantics.
 *
 * Errors propagate verbatim from `fs.stat` (file genuinely missing is the
 * caller's problem to handle) and from `scanFile` / WASM integrity (those
 * are configuration faults, not per-file `ScanError`s — see
 * `parsers/scan.ts`).
 */
export async function getCacheable(
  filePath: string,
  opts: DispatchOptions,
): Promise<CacheableResult> {
  const strict = process.env.FUGAZI_CACHE_STRICT === '1';
  const store: ParseCacheStore = { cacheDir: opts.cacheDir };
  const key = deriveKey({
    filePath,
    parserId: opts.parserId,
    parserVersion: opts.parserVersion,
  });

  const fileStat = await stat(filePath);
  const cached = await read<CacheEntry>(store, key);
  const decision = classifyByStat(cached, fileStat.mtimeMs, fileStat.size, strict);

  // Fast path: stat matches AND not strict. Read source for downstream
  // consumers but skip the parse step.
  if (decision.outcome === 'fast') {
    const source = await readFile(filePath, 'utf8');
    return { result: decision.entry.result, source, hit: 'fast' };
  }

  // Slow path: stat matches AND strict. Verify xxh3 of source against the
  // stored digest. If it matches, return as 'slow'. If it doesn't match,
  // fall through to the cold path (we already have `source` in hand).
  if (decision.outcome === 'needs-slow' && cached !== null) {
    const source = await readFile(filePath, 'utf8');
    const digest = await xxh3(source);
    if (digest === cached.meta.xxh3) {
      return { result: cached.result, source, hit: 'slow' };
    }
    // xxh3 mismatch → cold rebuild; keep `source` to avoid re-reading.
    return await coldRebuild(filePath, source, fileStat.mtimeMs, fileStat.size, store, key);
  }

  // Cold path: cache miss OR stat mismatch. Read source, parse, write under
  // lock. We pass the source through to avoid re-reading once we already
  // have it in hand.
  const source = await readFile(filePath, 'utf8');
  return await coldRebuild(filePath, source, fileStat.mtimeMs, fileStat.size, store, key);
}

/**
 * Cold-path implementation: parse the source, compute xxh3, write under
 * lock, return the result with `hit: 'cold'`. Extracted so both the
 * "stat-mismatch" and "xxh3-mismatch" code paths share the same write
 * sequence.
 */
async function coldRebuild(
  filePath: string,
  source: string,
  mtimeMs: number,
  size: number,
  store: ParseCacheStore,
  key: string,
): Promise<CacheableResult> {
  const result = await scanFile(filePath, source);
  const digest = await xxh3(source);
  const entry: CacheEntry = {
    meta: { mtimeMs, size, xxh3: digest },
    result,
  };
  const blobPath = blobPathFor(store, key);
  await withLock(blobPath, async () => {
    await write<CacheEntry>(store, key, entry);
  });
  return { result, source, hit: 'cold' };
}
