/**
 * cache-paths.test.ts — T057-test acceptance suite for the Phase 3c.3
 * Dispatch B fast/slow/cold path dispatcher (T058) plus xxhash-wasm helper.
 *
 * Acceptance map:
 *   - Cold path on first call — `dispatch — cold path`
 *   - Fast path on unchanged mtime+size — `dispatch — fast path`
 *   - mtime/size change forces cold — `dispatch — invalidation`
 *   - FUGAZI_CACHE_STRICT=1 honoured (slow vs cold) — `dispatch — slow path`
 *   - xxh3 helper determinism + edge cases — `xxh3 helper`
 *
 * Determinism (FR-D3 / SC-15): same `source` → same xxh3 hex digest.
 */

import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decode as decodeCacheBlob, encode as encodeCacheBlob } from '../cache/codec.js';
import { getCacheable } from '../cache/dispatch.js';
import { xxh3 } from '../cache/hash.js';
import { blobPathFor, deriveKey } from '../cache/store.js';
import type { CacheEntry } from '../cache/types.js';

// --------------------------------------------------------------------------
// Shared fixtures
// --------------------------------------------------------------------------

const PARSER_ID = 'swc-wasm';
const PARSER_VERSION = '1.15.32';

interface Harness {
  readonly cacheDir: string;
  readonly sourceDir: string;
  readonly cleanup: () => Promise<void>;
}

async function makeHarness(): Promise<Harness> {
  const cacheDir = await mkdtemp(join(tmpdir(), 'fugazi-cache-paths-cache-'));
  const sourceDir = await mkdtemp(join(tmpdir(), 'fugazi-cache-paths-src-'));
  return {
    cacheDir,
    sourceDir,
    cleanup: async () => {
      await rm(cacheDir, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true, force: true });
    },
  };
}

const SAMPLE_SOURCE = 'export const x = 42;\nexport function id<T>(v: T): T { return v; }\n';
const SAMPLE_SOURCE_DIFFERENT_LEN =
  'export const x = 42;\nexport function id<T>(v: T): T { return v; }\nexport const y = 43;\n';
// Same byte length as SAMPLE_SOURCE but different content (last char swapped):
const SAMPLE_SOURCE_SAME_LEN =
  'export const x = 42;\nexport function id<T>(v: T): T { return v; }\n'.replace('42', '43');

let harness: Harness;
let savedStrict: string | undefined;

// Use Reflect.deleteProperty to clear FUGAZI_CACHE_STRICT — biome's
// noDelete rule prefers this to the `delete` operator, and assigning
// `undefined` directly stringifies to "undefined" inside Node's env proxy
// which would falsely satisfy the strict-mode check.
const clearStrictEnv = (): void => {
  Reflect.deleteProperty(process.env, 'FUGAZI_CACHE_STRICT');
};

beforeEach(async () => {
  harness = await makeHarness();
  savedStrict = process.env.FUGAZI_CACHE_STRICT;
  clearStrictEnv();
});

afterEach(async () => {
  if (savedStrict === undefined) {
    clearStrictEnv();
  } else {
    process.env.FUGAZI_CACHE_STRICT = savedStrict;
  }
  await harness.cleanup();
});

const writeSource = async (name: string, content: string): Promise<string> => {
  const filePath = join(harness.sourceDir, name);
  await writeFile(filePath, content);
  return filePath;
};

const dispatchOpts = () => ({
  cacheDir: harness.cacheDir,
  parserId: PARSER_ID,
  parserVersion: PARSER_VERSION,
});

// --------------------------------------------------------------------------
// Cold path — 2 cases
// --------------------------------------------------------------------------

describe('dispatch — cold path', () => {
  it('first call on a fresh file returns hit: cold and persists the cache blob', async () => {
    const filePath = await writeSource('fresh.ts', SAMPLE_SOURCE);
    const got = await getCacheable(filePath, dispatchOpts());
    expect(got.hit).toBe('cold');
    expect(got.source).toBe(SAMPLE_SOURCE);
    expect(got.result).toBeDefined();
    expect(got.result.errors).toEqual([]);

    const key = deriveKey({ filePath, parserId: PARSER_ID, parserVersion: PARSER_VERSION });
    const blobPath = blobPathFor({ cacheDir: harness.cacheDir }, key);
    const blob = await readFile(blobPath);
    expect(blob.length).toBeGreaterThan(0);

    const { value } = decodeCacheBlob<CacheEntry>(blob);
    expect(value.meta.size).toBe(Buffer.byteLength(SAMPLE_SOURCE));
    expect(value.meta.xxh3).toMatch(/^[0-9a-f]{16}$/);
  });

  it('cold path returns parsed AST that scanFile would yield', async () => {
    const filePath = await writeSource('parses.ts', SAMPLE_SOURCE);
    const got = await getCacheable(filePath, dispatchOpts());
    expect(got.hit).toBe('cold');
    expect(got.result.ast).not.toBeNull();
  });
});

// --------------------------------------------------------------------------
// Fast path — 2 cases
// --------------------------------------------------------------------------

describe('dispatch — fast path', () => {
  it('second call with unchanged mtime+size returns hit: fast', async () => {
    const filePath = await writeSource('warm.ts', SAMPLE_SOURCE);
    const first = await getCacheable(filePath, dispatchOpts());
    expect(first.hit).toBe('cold');

    const second = await getCacheable(filePath, dispatchOpts());
    expect(second.hit).toBe('fast');
    expect(second.source).toBe(SAMPLE_SOURCE);
  });

  it('fast-path source matches file content byte-for-byte', async () => {
    const filePath = await writeSource('byteexact.ts', SAMPLE_SOURCE);
    await getCacheable(filePath, dispatchOpts());
    const got = await getCacheable(filePath, dispatchOpts());
    expect(got.hit).toBe('fast');
    const onDisk = await readFile(filePath, 'utf8');
    expect(got.source).toBe(onDisk);
  });
});

// --------------------------------------------------------------------------
// Invalidation — 2 cases
// --------------------------------------------------------------------------

describe('dispatch — invalidation', () => {
  it('changing mtime (utimes) forces cold path', async () => {
    const filePath = await writeSource('mtime-bump.ts', SAMPLE_SOURCE);
    const first = await getCacheable(filePath, dispatchOpts());
    expect(first.hit).toBe('cold');

    // Bump mtime forward by 5 seconds. atime equals mtime to keep things
    // simple — the dispatcher only inspects mtimeMs.
    const st = await stat(filePath);
    const newMtime = new Date(st.mtimeMs + 5_000);
    await utimes(filePath, newMtime, newMtime);

    const second = await getCacheable(filePath, dispatchOpts());
    expect(second.hit).toBe('cold');
  });

  it('changing size (overwrite with longer content) forces cold path', async () => {
    const filePath = await writeSource('size-bump.ts', SAMPLE_SOURCE);
    const first = await getCacheable(filePath, dispatchOpts());
    expect(first.hit).toBe('cold');

    await writeFile(filePath, SAMPLE_SOURCE_DIFFERENT_LEN);
    const second = await getCacheable(filePath, dispatchOpts());
    expect(second.hit).toBe('cold');
    expect(second.source).toBe(SAMPLE_SOURCE_DIFFERENT_LEN);
  });
});

// --------------------------------------------------------------------------
// Slow path — 2 cases (FUGAZI_CACHE_STRICT=1)
// --------------------------------------------------------------------------

describe('dispatch — slow path', () => {
  it('FUGAZI_CACHE_STRICT=1 with matching xxh3 returns hit: slow', async () => {
    const filePath = await writeSource('strict-match.ts', SAMPLE_SOURCE);
    const first = await getCacheable(filePath, dispatchOpts());
    expect(first.hit).toBe('cold');

    process.env.FUGAZI_CACHE_STRICT = '1';
    const second = await getCacheable(filePath, dispatchOpts());
    expect(second.hit).toBe('slow');
    expect(second.source).toBe(SAMPLE_SOURCE);
  });

  it('FUGAZI_CACHE_STRICT=1 with forged xxh3 mismatch falls through to cold', async () => {
    const filePath = await writeSource('strict-mismatch.ts', SAMPLE_SOURCE);
    const first = await getCacheable(filePath, dispatchOpts());
    expect(first.hit).toBe('cold');

    // Forge: read the cache blob, flip the stored xxh3 digest to a known-bad
    // value, write it back. Stat is unchanged so the fast-path criterion
    // still matches; only the slow-path xxh3 verification will catch it.
    const key = deriveKey({ filePath, parserId: PARSER_ID, parserVersion: PARSER_VERSION });
    const blobPath = blobPathFor({ cacheDir: harness.cacheDir }, key);
    const blob = await readFile(blobPath);
    const { value } = decodeCacheBlob<CacheEntry>(blob);
    const forged: CacheEntry = {
      meta: { ...value.meta, xxh3: '0000000000000000' },
      result: value.result,
    };
    await writeFile(blobPath, encodeCacheBlob<CacheEntry>(forged));

    process.env.FUGAZI_CACHE_STRICT = '1';
    const second = await getCacheable(filePath, dispatchOpts());
    expect(second.hit).toBe('cold');
  });

  it('FUGAZI_CACHE_STRICT=1 with same-length-but-different-content falls through to cold', async () => {
    // This is a regression case: mtime+size could BOTH match (if the FS
    // doesn't tick between writes and bytes happen to be the same length),
    // but the actual content has changed. Slow-path xxh3 should detect it.
    const filePath = await writeSource('strict-samelen.ts', SAMPLE_SOURCE);
    const first = await getCacheable(filePath, dispatchOpts());
    expect(first.hit).toBe('cold');

    // Replace content with same byte length but different bytes, then reset
    // mtime back to the cached value to simulate an FS that didn't tick.
    const stBefore = await stat(filePath);
    expect(SAMPLE_SOURCE_SAME_LEN.length).toBe(SAMPLE_SOURCE.length);
    await writeFile(filePath, SAMPLE_SOURCE_SAME_LEN);
    const restoredMtime = new Date(stBefore.mtimeMs);
    await utimes(filePath, restoredMtime, restoredMtime);

    process.env.FUGAZI_CACHE_STRICT = '1';
    const second = await getCacheable(filePath, dispatchOpts());
    expect(second.hit).toBe('cold');
    expect(second.source).toBe(SAMPLE_SOURCE_SAME_LEN);
  });
});

// --------------------------------------------------------------------------
// xxh3 helper — 4 cases
// --------------------------------------------------------------------------

describe('xxh3 helper', () => {
  it('is deterministic across two calls for the same string input', async () => {
    const a = await xxh3('hello world');
    const b = await xxh3('hello world');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('handles empty string and returns a stable digest', async () => {
    const a = await xxh3('');
    const b = await xxh3('');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('handles binary buffer input', async () => {
    const a = await xxh3(Buffer.from([0, 1, 2, 3]));
    const b = await xxh3(Buffer.from([0, 1, 2, 3]));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('different inputs produce different digests', async () => {
    const a = await xxh3('hello world');
    const b = await xxh3('hello worle');
    expect(a).not.toBe(b);
  });
});
