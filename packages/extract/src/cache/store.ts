/**
 * store.ts — Phase 3c.3 Dispatch A (T056) — async writer/reader over the
 * msgpackr blob format defined in `codec.ts`.
 *
 * Layout under `<cacheDir>`:
 *     <cacheDir>/parse/<key>.msgpack
 *
 * Where `<key>` is a hex SHA-256 derived via `deriveKey({ filePath, parserId,
 * parserVersion })`. NUL-separated input prevents concat ambiguity:
 * `('a','b\0c','d')` and `('a','b','c\0d')` produce different keys (T055-test
 * #16).
 *
 * Read miss policy (T056 acceptance: "Cache version mismatch does not throw"):
 *   - file missing (ENOENT/ENOTDIR) → `null`
 *   - decoded version mismatch       → `null`
 *   - codec throws CACHE_CORRUPTED   → propagate (signal to upstream re-parse)
 *
 * Write failure policy: any I/O error during mkdir or writeFile is wrapped as
 * `FugaziCacheError(CACHE_WRITE_FAILED)` with the verbatim message format
 * documented in the prompt — fixture-asserted byte-for-byte.
 *
 * Locking + fast/slow path live in Dispatch B (T058); this dispatch
 * intentionally does not touch them.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FugaziCacheError } from '@fugazi/types';
import { CACHE_VERSION, decode, encode } from './codec.js';

const PARSE_SUBDIR = 'parse';
const BLOB_EXT = '.msgpack';

interface NodeError {
  readonly code?: string;
}

/** True for "this file/dir does not exist" — both ENOENT and ENOTDIR count. */
const isFileNotFound = (err: unknown): boolean => {
  if (err === null || typeof err !== 'object') return false;
  const code = (err as NodeError).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

/**
 * The components that uniquely identify a cache entry. `filePath` is the
 * absolute (canonicalised by the caller) path of the source file;
 * `parserId` is a stable identifier for the parser engine (e.g. `'swc-wasm'`);
 * `parserVersion` is the engine's reported version string. `lang` (T310) is
 * an optional language discriminator that namespaces the key — `'ts'` /
 * `'py'` — so a TS file and a Python file with identical filenames cannot
 * collide on the same key. When omitted, defaults to `'ts'` to preserve
 * backwards-compat with cache entries written before T310.
 *
 * Any change in any of these components invalidates the cache entry
 * deterministically.
 */
export interface CacheKeyParts {
  readonly filePath: string;
  readonly parserId: string;
  readonly parserVersion: string;
  /** Optional language tag — `'ts'` (default) or `'py'`. */
  readonly lang?: 'ts' | 'py';
}

/**
 * Derive the on-disk cache key (hex SHA-256) for a tuple of identifying
 * parts. Each component is preceded by a 4-byte big-endian uint32 of its
 * UTF-8 byte length, then a NUL terminator. The length prefix makes the
 * encoding UNAMBIGUOUS even when components themselves contain NUL: the
 * pair `('a','b\0c','d')` hashes a different byte stream from `('a','b','c\0d')`
 * because the embedded `\0` is part of a length-counted component, not a
 * separator (T055-test #16). The trailing NUL is a defensive separator;
 * collisions are already prevented by the length prefix alone, but having
 * both keeps the format easy to debug if we ever inspect a raw key input.
 *
 * T310 ordering: the language tag is hashed FIRST as `'lang:ts'` /
 * `'lang:py'`. Existing pre-T310 entries (which were hashed without a lang
 * component) cleanly miss against new readers — the cache miss is a no-op
 * (read returns null on missing blobs) and the next write populates a
 * properly-namespaced entry. No data corruption, no migration step.
 *
 * Synchronous SHA-256 is fine here: input is < 1KB, Promise overhead would
 * dominate any async hashing cost.
 */
export function deriveKey(parts: CacheKeyParts): string {
  const hash = createHash('sha256');
  const lenBuf = Buffer.alloc(4);
  const lang = parts.lang ?? 'ts';
  const components: readonly string[] = [
    `lang:${lang}`,
    parts.filePath,
    parts.parserId,
    parts.parserVersion,
  ];
  for (const component of components) {
    const bytes = Buffer.from(component, 'utf8');
    lenBuf.writeUInt32BE(bytes.length, 0);
    hash.update(lenBuf);
    hash.update(bytes);
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * Opaque handle — currently just records the cache root directory. Constructed
 * via `createStore`; mkdir is lazy (first `write` creates `<cacheDir>/parse`).
 */
export interface ParseCacheStore {
  readonly cacheDir: string;
}

export function createStore(cacheDir: string): ParseCacheStore {
  return { cacheDir };
}

/**
 * Compose the absolute on-disk path for a given key. Exported so Dispatch B's
 * dispatcher (cache/dispatch.ts) can compute the path for `withLock` without
 * duplicating the path-construction logic.
 */
export function blobPathFor(store: ParseCacheStore, key: string): string {
  return join(store.cacheDir, PARSE_SUBDIR, `${key}${BLOB_EXT}`);
}

/**
 * Write `value` into the cache under `key`. Encodes via the codec, ensures
 * `<cacheDir>/parse/` exists (recursive mkdir), then writes the blob. Any I/O
 * failure is wrapped as `FugaziCacheError(CACHE_WRITE_FAILED)` with the
 * verbatim message contract:
 *
 *     `Cache write failed for key '<key>' at '<path>': <cause.message>`
 *
 * Generic over `T`: callers must type-bind at the call site. Dispatch A uses
 * `ScanResult`; Dispatch B uses `CacheEntry`.
 */
export async function write<T>(store: ParseCacheStore, key: string, value: T): Promise<void> {
  const blob = encode<T>(value);
  const path = blobPathFor(store, key);
  const parseDir = join(store.cacheDir, PARSE_SUBDIR);
  try {
    await mkdir(parseDir, { recursive: true });
    await writeFile(path, blob);
  } catch (cause) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    throw new FugaziCacheError({
      code: 'CACHE_WRITE_FAILED',
      message: `Cache write failed for key '${key}' at '${path}': ${causeMsg}`,
      ...(cause instanceof Error ? { cause } : {}),
    });
  }
}

/**
 * Read the cached value for `key`. Returns `null` on:
 *   - file missing (ENOENT / ENOTDIR), OR
 *   - decoded version differs from the compile-time `CACHE_VERSION`
 *     (clean cache miss across version bumps; intentional, not an error).
 *
 * Propagates `FugaziCacheError(CACHE_CORRUPTED)` from the codec when the blob
 * is malformed — corruption is a signal that an upstream re-parse should
 * occur (and overwrite the bad blob via a subsequent `write`).
 *
 * Generic over `T`: callers are responsible for typing `T` at the call site
 * (the codec does not validate runtime shape).
 */
export async function read<T>(store: ParseCacheStore, key: string): Promise<T | null> {
  const path = blobPathFor(store, key);
  let blob: Buffer;
  try {
    blob = await readFile(path);
  } catch (cause) {
    if (isFileNotFound(cause)) return null;
    throw cause;
  }
  const { value, version } = decode<T>(blob);
  if (version !== CACHE_VERSION) return null;
  return value;
}
