/**
 * wasm-verify.ts — load-time SHA-256 verification of pinned WASM blobs (SC-19).
 *
 * Streams each blob through `crypto.createHash('sha256')` via `pipeline()` so
 * the file is never fully buffered in memory (parser WASM payloads can be
 * 5-10 MB). On mismatch throws `FugaziParseError({ code: 'WASM_INTEGRITY' })`
 * with a verbatim message identical to the install-time tool in
 * `tools/verify-wasm.ts`. On a missing file throws `FugaziError({ code:
 * 'FS_PATH_NOT_FOUND' })`.
 *
 * The same module exports `verifyAllPinned(pinsPath)` — used both by the
 * install-time CLI tool and by the parser loader in Phase 3c. Single source of
 * truth for both paths.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FugaziError, FugaziParseError } from './errors/index.js';

interface NodeError {
  readonly code?: string;
}

const isFileNotFound = (err: unknown): boolean => {
  if (err === null || typeof err !== 'object') {
    return false;
  }
  const code = (err as NodeError).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

export async function verifyWasmBlob(path: string, expectedSha256: string): Promise<void> {
  const hash = createHash('sha256');
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      hash.update(chunk);
      callback();
    },
  });

  try {
    await pipeline(createReadStream(path), sink);
  } catch (cause) {
    if (isFileNotFound(cause)) {
      throw new FugaziError({
        code: 'FS_PATH_NOT_FOUND',
        message: `Path not found: ${path}`,
        ...(cause instanceof Error ? { cause } : {}),
      });
    }
    throw cause;
  }

  const actual = hash.digest('hex');
  if (actual !== expectedSha256) {
    throw new FugaziParseError({
      code: 'WASM_INTEGRITY',
      message: `WASM integrity check failed for ${path}: expected ${expectedSha256}, got ${actual}`,
      context: { path, expected: expectedSha256, actual },
    });
  }
}

export async function verifyAllPinned(pinsPath: string): Promise<void> {
  const text = await readFile(pinsPath, 'utf8');
  const pins = JSON.parse(text) as Record<string, string>;
  const entries = Object.entries(pins);
  if (entries.length === 0) {
    return;
  }
  await Promise.all(entries.map(([path, hash]) => verifyWasmBlob(path, hash)));
}
