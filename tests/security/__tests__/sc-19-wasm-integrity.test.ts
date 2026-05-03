/**
 * sc-19-wasm-integrity.test.ts — Phase 3m T294 — SC-19 acceptance row.
 *
 * SC-19: WASM parser blob SHA-256 verified at install + at load. Tampered
 * blob fails fast with verbatim error:
 *   `WASM integrity check failed for <path>: expected <expected-hash>, got <actual-hash>`
 *
 * Both gates flow through `verifyWasmBlob` from `@fugazi/types`. The
 * install-time tool `tools/verify-wasm.ts` calls `verifyAllPinned`, which
 * delegates to `verifyWasmBlob` per entry. The load-time check at the
 * parser boot is exercised by `packages/extract/src/__tests__/wasm-integrity.test.ts`.
 *
 * Verification:
 *   1. Synthesize a temp file with known content + correct hash → succeeds.
 *   2. Tamper one byte → assertion fails with the verbatim error.
 *   3. Missing file → `FS_PATH_NOT_FOUND` error.
 *   4. The verbatim error format is asserted byte-for-byte.
 */

import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FugaziParseError, verifyAllPinned, verifyWasmBlob } from '@fugazi/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dir: string;

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fugazi-sc-19-'));
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('SC-19: WASM blob integrity at install + load (verbatim error)', () => {
  it('matching hash → resolves without throwing', async () => {
    const path = join(dir, 'matching.wasm');
    const bytes = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    await writeFile(path, bytes);
    await expect(verifyWasmBlob(path, sha256(bytes))).resolves.toBeUndefined();
  });

  it('one-byte-tampered blob → throws FugaziParseError with code WASM_INTEGRITY', async () => {
    const path = join(dir, 'tampered.wasm');
    const bytes = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    const tampered = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x01]);
    await writeFile(path, tampered);
    const expected = sha256(bytes);
    const actual = sha256(tampered);
    await expect(verifyWasmBlob(path, expected)).rejects.toMatchObject({
      code: 'WASM_INTEGRITY',
    });
    // Verbatim error string contract.
    try {
      await verifyWasmBlob(path, expected);
      expect.fail('verifyWasmBlob did not throw on tampered input');
    } catch (err) {
      expect(err).toBeInstanceOf(FugaziParseError);
      const msg = (err as Error).message;
      expect(msg).toBe(
        `WASM integrity check failed for ${path}: expected ${expected}, got ${actual}`,
      );
    }
  });

  it('missing blob → throws FugaziError with FS_PATH_NOT_FOUND', async () => {
    const missing = join(dir, 'definitely-not-here.wasm');
    await expect(verifyWasmBlob(missing, 'a'.repeat(64))).rejects.toMatchObject({
      code: 'FS_PATH_NOT_FOUND',
    });
  });

  it('verifyAllPinned: empty pins → resolves silently', async () => {
    const pinsPath = join(dir, 'empty.json');
    await writeFile(pinsPath, '{}', 'utf8');
    await expect(verifyAllPinned(pinsPath)).resolves.toBeUndefined();
  });

  it('verifyAllPinned: every-blob path is checked (one tampered → fails fast)', async () => {
    const okPath = join(dir, 'ok.wasm');
    const okBytes = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    await writeFile(okPath, okBytes);
    const tamperedPath = join(dir, 'tamper.wasm');
    const tamperedBytes = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x02]);
    await writeFile(tamperedPath, tamperedBytes);
    // Pins claim both paths have the OK hash; the tampered one mismatches.
    const pins = {
      [okPath]: sha256(okBytes),
      [tamperedPath]: sha256(okBytes),
    };
    const pinsPath = join(dir, 'mixed.json');
    await writeFile(pinsPath, JSON.stringify(pins), 'utf8');
    await expect(verifyAllPinned(pinsPath)).rejects.toMatchObject({
      code: 'WASM_INTEGRITY',
    });
  });

  it('verbatim error string format is preserved (CONTRACT)', async () => {
    // The exact format `WASM integrity check failed for <path>: expected <expected>, got <actual>`
    // is part of the project contract and must not drift.
    const path = join(dir, 'contract.wasm');
    const bytes = Uint8Array.from([0xff]);
    await writeFile(path, bytes);
    const expected = '0'.repeat(64);
    const actual = sha256(bytes);
    try {
      await verifyWasmBlob(path, expected);
      expect.fail('verifyWasmBlob did not throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg.startsWith('WASM integrity check failed for ')).toBe(true);
      expect(msg).toContain(`expected ${expected}`);
      expect(msg).toContain(`got ${actual}`);
    }
  });
});
