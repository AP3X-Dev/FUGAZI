/**
 * wasm-integrity.test.ts — T047-test
 *
 * Verifies the SHA-256 pinning + integrity scaffolding (SC-19) at parser load
 * time. Real oxc-parser-wasm and swc-wasm payloads land in Wave 5b-2 / 5b-3;
 * here we exercise the integrity layer with synthetic, self-generated WASM
 * fixtures (smallest valid module: magic-number + version) so we never need
 * to commit binary blobs.
 *
 * Three verbatim error contracts (per E5):
 *   1. `WASM integrity check failed for <path>: expected <pinned-hash>, got <actual-hash>`
 *      — emitted by `verifyWasmBlob` (shared install + load helper).
 *   2. `WASM blob '<blobKey>' is not registered in manifest`
 *      — emitted by `verifyWasmIntegrity` when the manifest lacks the key.
 *   3. `WASM blob not found at '<path>'`
 *      — emitted by `loadWasmModule` when the verified path is absent on disk.
 */

import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { FugaziParseError } from '@fugazi/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { __setManifestForTest, verifyWasmIntegrity } from '../wasm/integrity.js';
import { __clearWasmCacheForTest, loadWasmModule } from '../wasm/load.js';

// Smallest valid WebAssembly module: magic number + version 1.
const VALID_WASM = Uint8Array.from([
  0x00,
  0x61,
  0x73,
  0x6d, // \0asm
  0x01,
  0x00,
  0x00,
  0x00, // version 1
]);

// Single-byte-flipped variant — still a different SHA-256 from VALID_WASM.
const TAMPERED_WASM = Uint8Array.from([
  0x00,
  0x61,
  0x73,
  0x6d, // \0asm
  0x01,
  0x00,
  0x00,
  0x01, // version flipped from 1 -> different last byte
]);

// A second valid blob with distinct content (extra empty section terminator).
// Still parses as a valid WebAssembly module shape (magic + version is enough).
const VALID_WASM_ALT = Uint8Array.from([
  0x00,
  0x61,
  0x73,
  0x6d, // \0asm
  0x01,
  0x00,
  0x00,
  0x00, // version 1
  // (no sections; the file is the same as VALID_WASM — so we add a trailing
  // byte sequence that WebAssembly.compile will tolerate by appending an
  // empty custom section.)
  0x00, // section id = 0 (custom)
  0x01, // section size = 1 byte
  0x00, // empty name (length 0)
]);

// Use a sandbox under packages/extract/test/fixtures/wasm so tests are
// hermetic and don't pollute the source tree.
const FIXTURE_DIR = join(__dirname, '..', '..', 'test', 'fixtures', 'wasm');
const VALID_PATH = join(FIXTURE_DIR, 'valid.wasm');
const TAMPERED_PATH = join(FIXTURE_DIR, 'tampered.wasm');
const ALT_PATH = join(FIXTURE_DIR, 'alt.wasm');
const MISSING_PATH = join(FIXTURE_DIR, 'does-not-exist.wasm');

const sha256Hex = (bytes: Uint8Array): string => {
  const h = createHash('sha256');
  h.update(bytes);
  return h.digest('hex');
};

const VALID_HASH = sha256Hex(VALID_WASM);
const TAMPERED_HASH = sha256Hex(TAMPERED_WASM);
const ALT_HASH = sha256Hex(VALID_WASM_ALT);

beforeAll(async () => {
  await mkdir(FIXTURE_DIR, { recursive: true });
  await writeFile(VALID_PATH, VALID_WASM);
  await writeFile(TAMPERED_PATH, TAMPERED_WASM);
  await writeFile(ALT_PATH, VALID_WASM_ALT);
});

afterAll(async () => {
  __setManifestForTest(null);
  __clearWasmCacheForTest();
  await rm(FIXTURE_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  __setManifestForTest(null);
  __clearWasmCacheForTest();
});

describe('verifyWasmIntegrity', () => {
  it('resolves with the absolute blob path when the manifest hash matches', async () => {
    __setManifestForTest({
      blobs: { oxc: { path: 'valid.wasm', sha256: VALID_HASH } },
    });
    const resolved = await verifyWasmIntegrity('oxc', FIXTURE_DIR);
    expect(resolved).toBe(VALID_PATH);
  });

  it('throws FugaziParseError(WASM_INTEGRITY) with verbatim message on tampered hash', async () => {
    // Manifest pins the hash of TAMPERED_WASM, but the blob on disk at
    // valid.wasm is VALID_WASM — so the "got" hash is VALID_HASH and the
    // "expected" pinned hash is TAMPERED_HASH.
    __setManifestForTest({
      blobs: { oxc: { path: 'valid.wasm', sha256: TAMPERED_HASH } },
    });

    let caught: unknown;
    try {
      await verifyWasmIntegrity('oxc', FIXTURE_DIR);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziParseError);
    const err = caught as FugaziParseError;
    expect(err.code).toBe('WASM_INTEGRITY');
    expect(err.message).toBe(
      `WASM integrity check failed for ${VALID_PATH}: expected ${TAMPERED_HASH}, got ${VALID_HASH}`,
    );
  });

  it('rejects a single-byte-flipped blob (full-class verbatim message)', async () => {
    // Manifest pins the hash of the canonical VALID_WASM, but on disk the
    // tampered.wasm differs by one byte.
    __setManifestForTest({
      blobs: { oxc: { path: 'tampered.wasm', sha256: VALID_HASH } },
    });

    let caught: unknown;
    try {
      await verifyWasmIntegrity('oxc', FIXTURE_DIR);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziParseError);
    const err = caught as FugaziParseError;
    expect(err.code).toBe('WASM_INTEGRITY');
    expect(err.message).toBe(
      `WASM integrity check failed for ${TAMPERED_PATH}: expected ${VALID_HASH}, got ${TAMPERED_HASH}`,
    );
  });

  it('throws FugaziParseError(WASM_MISSING) with verbatim message on unknown manifest key', async () => {
    __setManifestForTest({
      blobs: { oxc: { path: 'valid.wasm', sha256: VALID_HASH } },
    });

    let caught: unknown;
    try {
      await verifyWasmIntegrity('swc', FIXTURE_DIR);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziParseError);
    const err = caught as FugaziParseError;
    expect(err.code).toBe('WASM_MISSING');
    expect(err.message).toBe(`WASM blob 'swc' is not registered in manifest`);
  });

  it('throws WASM_MISSING when the manifest blobs object is empty', async () => {
    __setManifestForTest({ blobs: {} });

    let caught: unknown;
    try {
      await verifyWasmIntegrity('oxc', FIXTURE_DIR);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziParseError);
    const err = caught as FugaziParseError;
    expect(err.code).toBe('WASM_MISSING');
    expect(err.message).toBe(`WASM blob 'oxc' is not registered in manifest`);
  });

  it('resolves multiple manifest entries independently', async () => {
    __setManifestForTest({
      blobs: {
        oxc: { path: 'valid.wasm', sha256: VALID_HASH },
        swc: { path: 'alt.wasm', sha256: ALT_HASH },
      },
    });
    const oxc = await verifyWasmIntegrity('oxc', FIXTURE_DIR);
    const swc = await verifyWasmIntegrity('swc', FIXTURE_DIR);
    expect(oxc).toBe(VALID_PATH);
    expect(swc).toBe(ALT_PATH);
  });
});

describe('loadWasmModule', () => {
  it('returns a WebAssembly.Module for a valid + matching blob', async () => {
    __setManifestForTest({
      blobs: { oxc: { path: 'valid.wasm', sha256: VALID_HASH } },
    });
    const mod = await loadWasmModule('oxc', FIXTURE_DIR);
    expect(mod).toBeInstanceOf(WebAssembly.Module);
  });

  it('throws FugaziParseError(WASM_MISSING) with verbatim message when blob path does not exist', async () => {
    // Manifest points at a path inside the fixture dir that we never wrote.
    __setManifestForTest({
      blobs: { oxc: { path: 'does-not-exist.wasm', sha256: VALID_HASH } },
    });

    let caught: unknown;
    try {
      await loadWasmModule('oxc', FIXTURE_DIR);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziParseError);
    const err = caught as FugaziParseError;
    expect(err.code).toBe('WASM_MISSING');
    expect(err.message).toBe(`WASM blob not found at '${MISSING_PATH}'`);
  });

  it('caches the compiled module — second call returns the same Module reference', async () => {
    __setManifestForTest({
      blobs: { oxc: { path: 'valid.wasm', sha256: VALID_HASH } },
    });
    const a = await loadWasmModule('oxc', FIXTURE_DIR);
    const b = await loadWasmModule('oxc', FIXTURE_DIR);
    expect(Object.is(a, b)).toBe(true);
  });

  it('recompiles after __clearWasmCacheForTest()', async () => {
    __setManifestForTest({
      blobs: { oxc: { path: 'valid.wasm', sha256: VALID_HASH } },
    });
    const a = await loadWasmModule('oxc', FIXTURE_DIR);
    __clearWasmCacheForTest();
    const b = await loadWasmModule('oxc', FIXTURE_DIR);
    // After clearing the cache the compiler should produce a fresh Module.
    expect(Object.is(a, b)).toBe(false);
    expect(b).toBeInstanceOf(WebAssembly.Module);
  });

  it('handles two distinct keys without cross-contamination', async () => {
    __setManifestForTest({
      blobs: {
        oxc: { path: 'valid.wasm', sha256: VALID_HASH },
        swc: { path: 'alt.wasm', sha256: ALT_HASH },
      },
    });
    const [oxc, swc] = await Promise.all([
      loadWasmModule('oxc', FIXTURE_DIR),
      loadWasmModule('swc', FIXTURE_DIR),
    ]);
    expect(oxc).toBeInstanceOf(WebAssembly.Module);
    expect(swc).toBeInstanceOf(WebAssembly.Module);
    expect(Object.is(oxc, swc)).toBe(false);
  });

  it('concurrent loads of the same key both succeed (cache settles deterministically)', async () => {
    __setManifestForTest({
      blobs: { oxc: { path: 'valid.wasm', sha256: VALID_HASH } },
    });
    const [a, b] = await Promise.all([
      loadWasmModule('oxc', FIXTURE_DIR),
      loadWasmModule('oxc', FIXTURE_DIR),
    ]);
    expect(a).toBeInstanceOf(WebAssembly.Module);
    expect(b).toBeInstanceOf(WebAssembly.Module);
    // Note: the impl currently lacks promise dedup; the second resolution may
    // be a fresh Module compiled from the same bytes. What the cache MUST
    // guarantee is that subsequent (post-settled) calls return the cached
    // singleton — verified separately above.
  });

  it('propagates WASM_INTEGRITY from the verifier when bytes mismatch the pin', async () => {
    __setManifestForTest({
      blobs: { oxc: { path: 'valid.wasm', sha256: TAMPERED_HASH } },
    });

    let caught: unknown;
    try {
      await loadWasmModule('oxc', FIXTURE_DIR);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziParseError);
    const err = caught as FugaziParseError;
    expect(err.code).toBe('WASM_INTEGRITY');
    expect(err.message).toBe(
      `WASM integrity check failed for ${VALID_PATH}: expected ${TAMPERED_HASH}, got ${VALID_HASH}`,
    );
  });
});

describe('test-only escape hatches', () => {
  it('__setManifestForTest(null) clears the cached manifest', async () => {
    // Inject a synthetic manifest, then clear it. After clearing, the
    // implementation should fall back to loading the on-disk manifest.json,
    // whose blobs object is empty in this wave — so a verify call should
    // throw WASM_MISSING for any key.
    __setManifestForTest({
      blobs: { oxc: { path: 'valid.wasm', sha256: VALID_HASH } },
    });
    const ok = await verifyWasmIntegrity('oxc', FIXTURE_DIR);
    expect(ok).toBe(VALID_PATH);

    __setManifestForTest(null);

    let caught: unknown;
    try {
      await verifyWasmIntegrity('oxc', FIXTURE_DIR);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziParseError);
    expect((caught as FugaziParseError).code).toBe('WASM_MISSING');
  });

  it('the package-root parameter is honored (path resolves relative to it)', async () => {
    // Use FIXTURE_DIR's parent as the base, and put the relative path with
    // the directory segment included — this confirms `resolve()` treats the
    // packageRoot argument as the base, not import.meta.url.
    const parent = dirname(FIXTURE_DIR);
    __setManifestForTest({
      blobs: { oxc: { path: 'wasm/valid.wasm', sha256: VALID_HASH } },
    });
    const resolved = await verifyWasmIntegrity('oxc', parent);
    expect(resolved).toBe(VALID_PATH);
  });
});
