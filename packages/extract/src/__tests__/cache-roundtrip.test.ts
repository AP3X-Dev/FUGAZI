/**
 * cache-roundtrip.test.ts — T055-test acceptance suite for the Phase 3c.3
 * Dispatch A msgpackr cache codec + writer/reader (T056).
 *
 * Acceptance map:
 *   - 12+ round-trip tests across AST shapes — see `cache codec — round-trip`
 *   - Determinism: same input → same byte-output — `cache codec — determinism`
 *   - Version mismatch returns null (no throw) — `cache codec — version stamp`
 *   - Truncated blob throws CACHE_CORRUPTED  — `cache codec — corruption`
 *   - Key derivation: filePath/parserId/parserVersion — `cache key derivation`
 *   - Write-failure verbatim error format — `cache store — write`
 *
 * Each `describe` block lists its case count in its docstring.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FugaziCacheError } from '@fugazi/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CACHE_VERSION,
  decode as decodeCacheBlob,
  encode as encodeCacheBlob,
} from '../cache/codec.js';
import { createStore, deriveKey, read, write } from '../cache/store.js';
import type { ParseCacheStore } from '../cache/store.js';
import type { ScanResult } from '../parsers/scan.js';
import type { Program, Statement } from '../parsers/types.js';
import type {
  IoScanError,
  ParseFailedScanError,
  UnsupportedLanguageScanError,
} from '../scan-error.js';

// --------------------------------------------------------------------------
// Shared fixtures
// --------------------------------------------------------------------------

let tmpRoot: string;
let store: ParseCacheStore;

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'fugazi-cache-roundtrip-'));
  store = createStore(tmpRoot);
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

const pos = (line: number, column: number, byteOffset: number) =>
  ({ line, column, byteOffset }) as const;

const range = (s: readonly [number, number, number], e: readonly [number, number, number]) =>
  ({ start: pos(s[0], s[1], s[2]), end: pos(e[0], e[1], e[2]) }) as const;

const tinyProgram = (): Program => ({
  kind: 'Program',
  body: [
    {
      kind: 'ImportDecl',
      source: './neighbour.js',
      range: range([1, 0, 0], [1, 27, 27]),
    },
  ],
  filename: '/repo/src/tiny.ts',
  language: 'ts',
  range: range([1, 0, 0], [1, 27, 27]),
});

const fiftyStatementProgram = (): Program => {
  const body: Statement[] = [];
  for (let i = 0; i < 50; i++) {
    const r = range([i + 1, 0, i * 32], [i + 1, 30, i * 32 + 30]);
    if (i % 3 === 0) {
      body.push({
        kind: 'ImportDecl',
        source: `./mod-${i}.js`,
        range: r,
      });
    } else if (i % 3 === 1) {
      body.push({
        kind: 'ExportDecl',
        source: i % 2 === 0 ? null : `./reexp-${i}.js`,
        range: r,
      });
    } else {
      body.push({ kind: 'UnknownStatement', range: r });
    }
  }
  return {
    kind: 'Program',
    body,
    filename: '/repo/src/fifty.ts',
    language: 'ts',
    range: range([1, 0, 0], [50, 30, 50 * 32]),
  };
};

const parseFailedError = (
  file: string,
  line: number,
  column: number,
  byteOffset: number,
  message: string,
): ParseFailedScanError => ({
  kind: 'parse_failed',
  file,
  position: pos(line, column, byteOffset),
  message,
  code: 'PARSE_SYNTAX_ERROR',
});

const unsupportedError = (file: string, extension: string): UnsupportedLanguageScanError => ({
  kind: 'unsupported_language',
  file,
  extension,
  message: `Unsupported language for file '${file}': extension '${extension}' is not recognized`,
});

const ioError = (file: string): IoScanError => ({
  kind: 'io',
  file,
  code: 'FS_PATH_NOT_FOUND',
  message: `File not found: '${file}'`,
});

const sampleParts = (
  overrides: Partial<{ filePath: string; parserId: string; parserVersion: string }> = {},
) => ({
  filePath: '/repo/src/x.ts',
  parserId: 'swc-wasm',
  parserVersion: '1.15.32',
  ...overrides,
});

const writeAndRead = async (key: string, value: ScanResult): Promise<ScanResult | null> => {
  await write<ScanResult>(store, key, value);
  return read<ScanResult>(store, key);
};

// --------------------------------------------------------------------------
// Round-trip — 5 cases
// --------------------------------------------------------------------------

describe('cache codec — round-trip', () => {
  it('round-trips an empty ScanResult (ast: null, no errors)', async () => {
    const value: ScanResult = { ast: null, errors: [] };
    const got = await writeAndRead(deriveKey(sampleParts({ filePath: '/repo/empty.ts' })), value);
    expect(got).not.toBeNull();
    expect(got).toEqual(value);
  });

  it('round-trips a tiny Program with one ImportDecl', async () => {
    const value: ScanResult = { ast: tinyProgram(), errors: [] };
    const key = deriveKey(sampleParts({ filePath: '/repo/tiny.ts' }));
    const got = await writeAndRead(key, value);
    expect(got).not.toBeNull();
    expect(JSON.stringify(got)).toBe(JSON.stringify(value));
  });

  it('round-trips a 50-statement Program with mixed kinds', async () => {
    const value: ScanResult = { ast: fiftyStatementProgram(), errors: [] };
    const key = deriveKey(sampleParts({ filePath: '/repo/fifty.ts' }));
    const got = await writeAndRead(key, value);
    expect(got).not.toBeNull();
    expect(JSON.stringify(got)).toBe(JSON.stringify(value));
  });

  it('round-trips a ScanResult with three parse_failed errors', async () => {
    const file = '/repo/broken.ts';
    const value: ScanResult = {
      ast: null,
      errors: [
        parseFailedError(file, 1, 5, 5, "Unexpected token '}'"),
        parseFailedError(file, 3, 0, 22, 'Unexpected end of input'),
        parseFailedError(file, 4, 7, 40, 'Identifier expected'),
      ],
    };
    const key = deriveKey(sampleParts({ filePath: file }));
    const got = await writeAndRead(key, value);
    expect(got).not.toBeNull();
    expect(got).toEqual(value);
  });

  it('round-trips a ScanResult with mixed parse_failed + unsupported_language + io', async () => {
    const value: ScanResult = {
      ast: null,
      errors: [
        parseFailedError('/repo/a.ts', 2, 4, 12, 'Unexpected token'),
        unsupportedError('/repo/data.bin', '.bin'),
        ioError('/repo/missing.ts'),
      ],
    };
    const key = deriveKey(sampleParts({ filePath: '/repo/mixed.ts' }));
    const got = await writeAndRead(key, value);
    expect(got).not.toBeNull();
    expect(got).toEqual(value);
  });
});

// --------------------------------------------------------------------------
// Determinism — 2 cases
// --------------------------------------------------------------------------

describe('cache codec — determinism', () => {
  it('encode is byte-equal across two runs for the same value', () => {
    const value: ScanResult = { ast: fiftyStatementProgram(), errors: [] };
    const b1 = encodeCacheBlob(value);
    const b2 = encodeCacheBlob(value);
    expect(Buffer.compare(b1, b2)).toBe(0);
  });

  it('byte-equal after read/re-encode (full round-trip stays deterministic)', async () => {
    const value: ScanResult = { ast: tinyProgram(), errors: [] };
    const key = deriveKey(sampleParts({ filePath: '/repo/det.ts' }));
    await write<ScanResult>(store, key, value);
    const got = await read<ScanResult>(store, key);
    expect(got).not.toBeNull();
    if (got !== null) {
      const b1 = encodeCacheBlob(value);
      const b2 = encodeCacheBlob(got);
      expect(Buffer.compare(b1, b2)).toBe(0);
    }
  });
});

// --------------------------------------------------------------------------
// Version stamp — 2 cases
// --------------------------------------------------------------------------

describe('cache codec — version stamp', () => {
  it('encoded blob starts with the 4-byte big-endian CACHE_VERSION', () => {
    const value: ScanResult = { ast: null, errors: [] };
    const blob = encodeCacheBlob(value);
    expect(blob.length).toBeGreaterThanOrEqual(4);
    expect(blob.readUInt32BE(0)).toBe(CACHE_VERSION);
  });

  it('read returns null when the stored version != CACHE_VERSION', async () => {
    const value: ScanResult = { ast: tinyProgram(), errors: [] };
    const key = deriveKey(sampleParts({ filePath: '/repo/version-mismatch.ts' }));
    await write<ScanResult>(store, key, value);
    const blobPath = join(tmpRoot, 'parse', `${key}.msgpack`);
    const blob = await readFile(blobPath);
    // Overwrite first 4 bytes with version=999 (still valid uint32, !== CACHE_VERSION).
    blob.writeUInt32BE(999, 0);
    await writeFile(blobPath, blob);
    const got = await read<ScanResult>(store, key);
    expect(got).toBeNull();
  });
});

// --------------------------------------------------------------------------
// Corruption — 4 cases
// --------------------------------------------------------------------------

describe('cache codec — corruption', () => {
  it('truncated blob (last 5 bytes chopped) throws CACHE_CORRUPTED on read', async () => {
    const value: ScanResult = { ast: fiftyStatementProgram(), errors: [] };
    const key = deriveKey(sampleParts({ filePath: '/repo/truncated.ts' }));
    await write<ScanResult>(store, key, value);
    const blobPath = join(tmpRoot, 'parse', `${key}.msgpack`);
    const blob = await readFile(blobPath);
    // Slice off final 5 bytes — guaranteed to mangle the msgpackr payload tail
    // for a non-trivial Program (>5 trailing bytes).
    expect(blob.length).toBeGreaterThan(5);
    await writeFile(blobPath, blob.subarray(0, blob.length - 5));
    await expect(read<ScanResult>(store, key)).rejects.toBeInstanceOf(FugaziCacheError);
    await expect(read<ScanResult>(store, key)).rejects.toMatchObject({ code: 'CACHE_CORRUPTED' });
  });

  it('empty blob (0 bytes) throws CACHE_CORRUPTED', async () => {
    const key = deriveKey(sampleParts({ filePath: '/repo/empty-blob.ts' }));
    // Pre-create the parse subdir via a successful write, then overwrite.
    await write<ScanResult>(store, key, { ast: null, errors: [] });
    const blobPath = join(tmpRoot, 'parse', `${key}.msgpack`);
    await writeFile(blobPath, Buffer.alloc(0));
    await expect(read<ScanResult>(store, key)).rejects.toMatchObject({
      code: 'CACHE_CORRUPTED',
    });
  });

  it('sub-magic blob (3 bytes) throws CACHE_CORRUPTED', async () => {
    const key = deriveKey(sampleParts({ filePath: '/repo/sub-magic.ts' }));
    await write<ScanResult>(store, key, { ast: null, errors: [] });
    const blobPath = join(tmpRoot, 'parse', `${key}.msgpack`);
    await writeFile(blobPath, Buffer.from([0x00, 0x00, 0x00]));
    await expect(read<ScanResult>(store, key)).rejects.toMatchObject({
      code: 'CACHE_CORRUPTED',
    });
  });

  it('decode of an empty Buffer throws CACHE_CORRUPTED directly', () => {
    expect(() => decodeCacheBlob<ScanResult>(Buffer.alloc(0))).toThrow(FugaziCacheError);
    try {
      decodeCacheBlob<ScanResult>(Buffer.alloc(0));
    } catch (err) {
      expect((err as FugaziCacheError).code).toBe('CACHE_CORRUPTED');
    }
  });
});

// --------------------------------------------------------------------------
// Cache key derivation — 4 cases
// --------------------------------------------------------------------------

describe('cache key derivation', () => {
  it('same parts produce the same key (stable across calls)', () => {
    const a = deriveKey(sampleParts());
    const b = deriveKey(sampleParts());
    expect(a).toBe(b);
    // Hex-encoded SHA-256 is exactly 64 chars.
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different filePath → different key', () => {
    const a = deriveKey(sampleParts({ filePath: '/repo/a.ts' }));
    const b = deriveKey(sampleParts({ filePath: '/repo/b.ts' }));
    expect(a).not.toBe(b);
  });

  it('different parserVersion → different key', () => {
    const a = deriveKey(sampleParts({ parserVersion: '1.0.0' }));
    const b = deriveKey(sampleParts({ parserVersion: '2.0.0' }));
    expect(a).not.toBe(b);
  });

  it("NUL separator is unambiguous: ('a','b\\0c','d') !== ('a','b','c\\0d')", () => {
    const a = deriveKey({ filePath: 'a', parserId: 'b\0c', parserVersion: 'd' });
    const b = deriveKey({ filePath: 'a', parserId: 'b', parserVersion: 'c\0d' });
    expect(a).not.toBe(b);
  });
});

// --------------------------------------------------------------------------
// Cache store — write / miss path (3 cases)
// --------------------------------------------------------------------------

describe('cache store — write', () => {
  it('read on a never-written key returns null (no throw)', async () => {
    const got = await read<ScanResult>(
      store,
      deriveKey(sampleParts({ filePath: '/repo/never-written.ts' })),
    );
    expect(got).toBeNull();
  });

  it('rejects with FugaziCacheError(CACHE_WRITE_FAILED) when parent of cacheDir is a file', async () => {
    // Create a regular file, then try to use it as a cacheDir — mkdir fails
    // with ENOTDIR / EEXIST, surfaced through the write contract.
    const fileAsDir = join(tmpRoot, 'not-a-dir-file');
    await writeFile(fileAsDir, 'this is a file, not a directory');
    const badStore = createStore(fileAsDir);
    const key = deriveKey(sampleParts({ filePath: '/repo/should-fail.ts' }));
    await expect(
      write<ScanResult>(badStore, key, { ast: null, errors: [] }),
    ).rejects.toBeInstanceOf(FugaziCacheError);
    try {
      await write<ScanResult>(badStore, key, { ast: null, errors: [] });
    } catch (err) {
      expect(err).toBeInstanceOf(FugaziCacheError);
      const ce = err as FugaziCacheError;
      expect(ce.code).toBe('CACHE_WRITE_FAILED');
      const expectedPath = join(fileAsDir, 'parse', `${key}.msgpack`);
      // Verbatim contract — fixture-asserted byte-for-byte:
      //   `Cache write failed for key '<key>' at '<path>': <cause.message>`
      expect(
        ce.message.startsWith(`Cache write failed for key '${key}' at '${expectedPath}': `),
      ).toBe(true);
      expect(ce.cause).toBeInstanceOf(Error);
    }
  });

  it('write then read returns deep-equal value (sanity)', async () => {
    const value: ScanResult = { ast: tinyProgram(), errors: [] };
    const key = deriveKey(sampleParts({ filePath: '/repo/sanity.ts' }));
    await write<ScanResult>(store, key, value);
    const got = await read<ScanResult>(store, key);
    expect(got).toEqual(value);
  });
});
