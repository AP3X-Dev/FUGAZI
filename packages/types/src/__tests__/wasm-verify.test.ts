import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FugaziError, FugaziParseError } from '../errors/index.js';
import { verifyAllPinned, verifyWasmBlob } from '../wasm-verify.js';

const FIXTURE_DIR = join(__dirname, '__fixtures__');
const WASM_PATH = join(FIXTURE_DIR, 'sample.wasm');
const PINS_EMPTY_PATH = join(FIXTURE_DIR, 'wasm-pins-empty.json');
const PINS_MATCH_PATH = join(FIXTURE_DIR, 'wasm-pins-match.json');
const PINS_MISMATCH_PATH = join(FIXTURE_DIR, 'wasm-pins-mismatch.json');

// 16-byte tiny WASM-magic-number-prefixed blob.
const WASM_BYTES = Buffer.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

const computeSha256 = (buf: Buffer): string => {
  const hash = createHash('sha256');
  hash.update(buf);
  return hash.digest('hex');
};

const EXPECTED_SHA256 = computeSha256(WASM_BYTES);
const WRONG_SHA256 = '0'.repeat(64);

beforeAll(async () => {
  await mkdir(FIXTURE_DIR, { recursive: true });
  await writeFile(WASM_PATH, WASM_BYTES);
  await writeFile(PINS_EMPTY_PATH, JSON.stringify({}));
  await writeFile(PINS_MATCH_PATH, JSON.stringify({ [WASM_PATH]: EXPECTED_SHA256 }));
  await writeFile(PINS_MISMATCH_PATH, JSON.stringify({ [WASM_PATH]: WRONG_SHA256 }));
});

afterAll(async () => {
  await rm(FIXTURE_DIR, { recursive: true, force: true });
});

describe('verifyWasmBlob', () => {
  it('resolves void when the actual SHA-256 matches the pinned hash', async () => {
    await expect(verifyWasmBlob(WASM_PATH, EXPECTED_SHA256)).resolves.toBeUndefined();
  });

  it('throws FugaziParseError(WASM_INTEGRITY) with verbatim message on mismatch', async () => {
    let caught: unknown;
    try {
      await verifyWasmBlob(WASM_PATH, WRONG_SHA256);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziParseError);
    const err = caught as FugaziParseError;
    expect(err.code).toBe('WASM_INTEGRITY');
    expect(err.message).toBe(
      `WASM integrity check failed for ${WASM_PATH}: expected ${WRONG_SHA256}, got ${EXPECTED_SHA256}`,
    );
    expect(err.context).toEqual({
      path: WASM_PATH,
      expected: WRONG_SHA256,
      actual: EXPECTED_SHA256,
    });
  });

  it('throws FugaziError(FS_PATH_NOT_FOUND) when the file is missing', async () => {
    const missing = join(FIXTURE_DIR, 'does-not-exist.wasm');
    let caught: unknown;
    try {
      await verifyWasmBlob(missing, EXPECTED_SHA256);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziError);
    expect(caught).not.toBeInstanceOf(FugaziParseError);
    const err = caught as FugaziError;
    expect(err.code).toBe('FS_PATH_NOT_FOUND');
    expect(err.message).toBe(`Path not found: ${missing}`);
  });
});

describe('verifyAllPinned', () => {
  it('resolves void when the pins file is empty', async () => {
    await expect(verifyAllPinned(PINS_EMPTY_PATH)).resolves.toBeUndefined();
  });

  it('resolves void when every pin matches', async () => {
    await expect(verifyAllPinned(PINS_MATCH_PATH)).resolves.toBeUndefined();
  });

  it('throws FugaziParseError(WASM_INTEGRITY) when any pin mismatches', async () => {
    let caught: unknown;
    try {
      await verifyAllPinned(PINS_MISMATCH_PATH);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziParseError);
    const err = caught as FugaziParseError;
    expect(err.code).toBe('WASM_INTEGRITY');
    expect(err.message).toBe(
      `WASM integrity check failed for ${WASM_PATH}: expected ${WRONG_SHA256}, got ${EXPECTED_SHA256}`,
    );
  });
});
