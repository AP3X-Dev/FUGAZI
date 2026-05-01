/**
 * types.ts — Phase 3c.3 Dispatch B (T058) — shared cache entry shape.
 *
 * Each on-disk blob written by Dispatch B's dispatcher wraps a `ScanResult`
 * in a `CacheEntry { meta, result }`. The codec / store from Dispatch A are
 * generic over the value type, so callers parameterise `<CacheEntry>` at
 * `read` / `write` call sites.
 *
 * `CacheMeta` carries the verification triple (mtimeMs, size, xxh3) used by
 * `getCacheable`'s fast/slow paths:
 *   - fast path : `mtimeMs` and `size` match — return cached `result` directly.
 *   - slow path : (FUGAZI_CACHE_STRICT=1) recompute xxh3 of the source and
 *                 compare with the stored `meta.xxh3` digest before reuse.
 *   - cold path : either of the above mismatches — re-parse + re-write.
 */

import type { ScanResult } from '../parsers/scan.js';

export interface CacheMeta {
  /**
   * mtime in milliseconds since epoch (Stats.mtimeMs). High-precision; works
   * cross-platform within ms granularity.
   */
  readonly mtimeMs: number;
  /** Byte size of the source file (Stats.size). */
  readonly size: number;
  /**
   * xxh3 hex digest of the source bytes (computed on cold-path write and
   * compared on slow-path verify). Empty string `''` is reserved for "not yet
   * computed" but in practice every `CacheEntry` written has a real digest;
   * the fast path doesn't need this field but storing it costs nothing and
   * enables the slow path on demand.
   */
  readonly xxh3: string;
}

export interface CacheEntry {
  readonly meta: CacheMeta;
  readonly result: ScanResult;
}

/** Discriminator for which path produced the result for `getCacheable`. */
export type CacheHit = 'fast' | 'slow' | 'cold';

/** Output of `getCacheable(file)`. */
export interface CacheableResult {
  readonly result: ScanResult;
  readonly source: string;
  readonly hit: CacheHit;
}
