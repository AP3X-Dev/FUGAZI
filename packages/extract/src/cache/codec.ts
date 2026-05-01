/**
 * codec.ts — Phase 3c.3 Dispatch A (T056) — msgpackr-based encode/decode for
 * the parse cache.
 *
 * On-disk layout for every cached value:
 *   bytes [0..4)  : big-endian uint32 cache version (currently `CACHE_VERSION`)
 *   bytes [4..)   : msgpackr-encoded payload of the value
 *
 * The codec is intentionally generic over the value type `T`; Dispatch A used
 * `ScanResult` directly, but Dispatch B (T058) wraps each entry in a
 * `CacheEntry { meta, result }` shape. The msgpackr serialization is
 * structural — only the TS types relax. Callers are responsible for typing
 * `T` at the call site.
 *
 * Determinism contract (FR-D3 / SC-15): for byte-equal input `x`, `encode(x)`
 * MUST produce byte-identical output across runs. msgpackr's `Packr` with
 * `useRecords: false` disables the structural-sharing dictionary (whose
 * insertion order changes across encodes); together with stable key insertion
 * order in the input objects this is sufficient. The roundtrip suite asserts
 * this fixture-style.
 *
 * Corruption surface (T055-test #9..#11): `decode` throws
 * `FugaziCacheError(CACHE_CORRUPTED)` when:
 *   - the blob is shorter than the 4-byte version magic, OR
 *   - msgpackr fails to parse the payload (truncated / random bytes).
 * Version mismatch is NOT corruption — `store.read` handles that by returning
 * `null` (cache miss) so an upstream re-parse occurs cleanly across version
 * bumps.
 */

import { FugaziCacheError } from '@fugazi/types';
import { Packr } from 'msgpackr';

/** Compile-time integer constant (T056). Bump on every breaking blob format change. */
export const CACHE_VERSION = 1 as const;

/**
 * Pre-allocated 4-byte magic prefix carrying `CACHE_VERSION` as big-endian
 * uint32. Allocated once at module load to avoid per-call `Buffer.alloc(4)`.
 * Treated as immutable; we slice into a fresh Buffer on every encode.
 */
export const CACHE_VERSION_MAGIC: Buffer = (() => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(CACHE_VERSION, 0);
  return b;
})();

const VERSION_PREFIX_BYTES = 4;

/**
 * Module-level singleton encoder/decoder. `useRecords: false` disables
 * msgpackr's structural-sharing dictionary so byte output is purely a function
 * of the input value (no cross-call state). All other options are defaults.
 */
const packr = new Packr({ useRecords: false });

/**
 * Encode a value to the on-disk blob format. Output buffer layout:
 * 4-byte big-endian version magic followed by the msgpackr payload.
 *
 * Generic over `T`: callers are responsible for typing the value at the call
 * site (Dispatch A used `ScanResult`; Dispatch B uses `CacheEntry`). The
 * msgpackr serialization is structural — no behavior changes with `T`.
 *
 * msgpackr's `pack` returns a Buffer that may be a view into a reused internal
 * buffer; `Buffer.concat` allocates fresh storage and the returned buffer is
 * safe to retain. The returned buffer is byte-identical across runs for
 * byte-equal `value` (determinism contract above).
 */
export function encode<T>(value: T): Buffer {
  const payload = packr.pack(value);
  return Buffer.concat([CACHE_VERSION_MAGIC, payload], CACHE_VERSION_MAGIC.length + payload.length);
}

/**
 * Decode an on-disk blob produced by `encode`. Returns the `version` (so the
 * caller can compare against `CACHE_VERSION` and decide whether to treat the
 * blob as a clean miss) plus the deserialised value.
 *
 * Generic over `T`: the caller must type-narrow at the call site. The codec
 * does NOT validate the runtime shape of the decoded value; trusting on-disk
 * data is acceptable here because (a) the cache directory is owned by the
 * tool, (b) msgpackr corruption surfaces as a parse error, and (c) the
 * version stamp prevents reading values written with an incompatible shape.
 *
 * Throws `FugaziCacheError(CACHE_CORRUPTED)` if the blob is shorter than the
 * 4-byte version magic OR if msgpackr fails to parse the payload. Version
 * mismatch alone is NOT corruption — that's the caller's policy decision.
 */
export function decode<T>(blob: Buffer): { value: T; version: number } {
  if (blob.length < VERSION_PREFIX_BYTES) {
    throw new FugaziCacheError({
      code: 'CACHE_CORRUPTED',
      message: `Cache blob is too short to contain a version prefix (got ${blob.length} bytes, need >= ${VERSION_PREFIX_BYTES})`,
    });
  }
  const version = blob.readUInt32BE(0);
  const payload = blob.subarray(VERSION_PREFIX_BYTES);
  let value: T;
  try {
    value = packr.unpack(payload) as T;
  } catch (cause) {
    throw new FugaziCacheError({
      code: 'CACHE_CORRUPTED',
      message: `Cache blob payload failed to decode: ${cause instanceof Error ? cause.message : String(cause)}`,
      ...(cause instanceof Error ? { cause } : {}),
    });
  }
  return { value, version };
}
