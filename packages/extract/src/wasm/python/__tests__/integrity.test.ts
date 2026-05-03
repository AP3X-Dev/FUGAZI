/**
 * integrity.test.ts — Phase 4a T301-test
 *
 * Mirrors `src/__tests__/wasm-integrity.test.ts` but exercises the
 * Python-specific integrity helper (`verifyPythonWasmIntegrity`) and its
 * test-only manifest injector (`__setPythonManifestForTest`). Three verbatim
 * error contracts are asserted here:
 *
 *   1. `WASM integrity check failed for <path>: expected <pinned-hash>, got <actual-hash>`
 *      — emitted by `verifyWasmBlob` (shared install + load helper).
 *   2. `WASM blob '<blobKey>' is not registered in manifest`
 *      — emitted by `verifyPythonWasmIntegrity` when the manifest lacks the key.
 *   3. `WASM blob not found at '<path>'`
 *      — emitted by `verifyPythonWasmIntegrity` when the verified path is
 *      absent on disk (via FS_PATH_NOT_FOUND remapping).
 */

import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FugaziParseError } from '@fugazi/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { __setPythonManifestForTest, verifyPythonWasmIntegrity } from '../integrity.js';

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

const FIXTURE_DIR = join(__dirname, '..', '..', '..', '..', 'test', 'fixtures', 'wasm-py');
const VALID_PATH = join(FIXTURE_DIR, 'valid.wasm');
const TAMPERED_PATH = join(FIXTURE_DIR, 'tampered.wasm');
const MISSING_PATH = join(FIXTURE_DIR, 'does-not-exist.wasm');

const sha256Hex = (bytes: Uint8Array): string => {
  const h = createHash('sha256');
  h.update(bytes);
  return h.digest('hex');
};

const VALID_HASH = sha256Hex(VALID_WASM);
const TAMPERED_HASH = sha256Hex(TAMPERED_WASM);

beforeAll(async () => {
  await mkdir(FIXTURE_DIR, { recursive: true });
  await writeFile(VALID_PATH, VALID_WASM);
  await writeFile(TAMPERED_PATH, TAMPERED_WASM);
});

afterAll(async () => {
  __setPythonManifestForTest(null);
  await rm(FIXTURE_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  __setPythonManifestForTest(null);
});

describe('verifyPythonWasmIntegrity', () => {
  it('resolves with the absolute blob path when the manifest hash matches', async () => {
    __setPythonManifestForTest({
      blobs: { 'tree-sitter-python': { path: 'valid.wasm', sha256: VALID_HASH } },
    });
    const resolved = await verifyPythonWasmIntegrity('tree-sitter-python', FIXTURE_DIR);
    expect(resolved).toBe(VALID_PATH);
  });

  it('throws WASM_INTEGRITY with verbatim message on tampered hash', async () => {
    // Manifest pins TAMPERED hash, but disk has VALID bytes.
    __setPythonManifestForTest({
      blobs: { 'tree-sitter-python': { path: 'valid.wasm', sha256: TAMPERED_HASH } },
    });

    let caught: unknown;
    try {
      await verifyPythonWasmIntegrity('tree-sitter-python', FIXTURE_DIR);
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

  it('throws WASM_MISSING with verbatim message on unknown manifest key', async () => {
    __setPythonManifestForTest({
      blobs: { 'tree-sitter-python': { path: 'valid.wasm', sha256: VALID_HASH } },
    });

    let caught: unknown;
    try {
      await verifyPythonWasmIntegrity('not-a-real-key', FIXTURE_DIR);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziParseError);
    const err = caught as FugaziParseError;
    expect(err.code).toBe('WASM_MISSING');
    expect(err.message).toBe(`WASM blob 'not-a-real-key' is not registered in manifest`);
  });

  it('throws WASM_MISSING with verbatim message when the blob path is absent', async () => {
    __setPythonManifestForTest({
      blobs: { 'tree-sitter-python': { path: 'does-not-exist.wasm', sha256: VALID_HASH } },
    });

    let caught: unknown;
    try {
      await verifyPythonWasmIntegrity('tree-sitter-python', FIXTURE_DIR);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziParseError);
    const err = caught as FugaziParseError;
    expect(err.code).toBe('WASM_MISSING');
    expect(err.message).toBe(`WASM blob not found at '${MISSING_PATH}'`);
  });

  it('rejects a single-byte-flipped blob on disk', async () => {
    __setPythonManifestForTest({
      blobs: { 'tree-sitter-python': { path: 'tampered.wasm', sha256: VALID_HASH } },
    });

    let caught: unknown;
    try {
      await verifyPythonWasmIntegrity('tree-sitter-python', FIXTURE_DIR);
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
});
