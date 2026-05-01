/**
 * hash.ts — Phase 3c.3 Dispatch B (T058) — xxhash-wasm helper.
 *
 * `xxh3(buffer | string)` returns a 16-char hex digest of the 64-bit xxhash
 * hash, used by `getCacheable`'s slow path to detect content changes that
 * mtime+size would miss (touch-without-modify, identical-size edits, etc).
 *
 * The xxhash-wasm module is a one-shot loader: `xxhash()` returns a Promise
 * that resolves to an `XXHashAPI` carrying compiled WASM hashers. We cache
 * that promise at module level so subsequent calls reuse the same compiled
 * instance without re-instantiating WASM. The module-level cache is safe in
 * a worker pool — each worker has its own module realm.
 *
 * Determinism (FR-D3 / SC-15): xxh64 is deterministic and seed-independent
 * here (we always use the default seed of 0n). Same input → same hex digest,
 * byte-for-byte. The roundtrip suite asserts this fixture-style.
 *
 * Note on the function name: the spec calls this "xxh3" but xxhash-wasm
 * v1.1.0 exposes XXH64 (not XXH3). The naming is preserved at the API
 * boundary because the upstream contract calls the field `meta.xxh3`; the
 * underlying algorithm is XXH64 via `h64ToString`. Both produce stable
 * 16-char hex digests for our cache-validation purposes.
 */

import xxhash, { type XXHashAPI } from 'xxhash-wasm';

let hasherPromise: Promise<XXHashAPI> | null = null;

function getHasher(): Promise<XXHashAPI> {
  if (hasherPromise === null) {
    hasherPromise = xxhash();
  }
  return hasherPromise;
}

/**
 * Compute a 16-char lowercase hex digest of `input`. Accepts string,
 * `Uint8Array`, or `Buffer`. The digest is deterministic for byte-equal
 * input (no salt/seed variation). Padding to 16 chars is defensive — for
 * inputs whose hash leading-bit is zero, `bigint.toString(16)` would emit
 * fewer than 16 chars; we pad to keep digest length stable across inputs.
 */
export async function xxh3(input: Buffer | Uint8Array | string): Promise<string> {
  const hasher = await getHasher();
  // h64ToString already returns a left-padded 16-char hex string for string
  // input, but we go through h64Raw + manual format to handle Buffer/Uint8Array
  // uniformly without copying. For string input we also use h64Raw via UTF-8
  // encoding so the helper has a single code path and identical behaviour
  // regardless of input shape.
  const bytes: Uint8Array =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : input instanceof Buffer
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : input;
  const raw: bigint = hasher.h64Raw(bytes);
  return raw.toString(16).padStart(16, '0');
}

/**
 * Test-only escape hatch — clears the module-level hasher promise so a fresh
 * `xxhash()` call is made on the next `xxh3()`. Intended for tests that need
 * to verify cold-start determinism. Production code MUST NOT call this.
 */
export function __resetHasherForTest(): void {
  hasherPromise = null;
}
