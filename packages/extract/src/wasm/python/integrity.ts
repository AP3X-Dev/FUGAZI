/**
 * python/integrity.ts — manifest-driven SHA-256 integrity verification of the
 * pinned tree-sitter-python WASM blob (Phase 4a T301; mirrors the SWC pattern
 * in `../integrity.ts`).
 *
 * Reads `packages/extract/wasm/manifest.json` once per process (lazy + cached)
 * and dispatches to `verifyWasmBlob` from `@fugazi/types` — the single source
 * of truth shared with the install-time tool at `tools/verify-wasm.ts`. On
 * mismatch the underlying helper throws `FugaziParseError(WASM_INTEGRITY)`
 * with the verbatim message
 *   `WASM integrity check failed for <path>: expected <pinned-hash>, got <actual-hash>`
 *
 * On a missing manifest entry (key not registered) this module raises
 * `FugaziParseError(WASM_MISSING)` with the verbatim message
 *   `WASM blob '<blobKey>' is not registered in manifest`
 *
 * Test-only escape hatch: `__setManifestForTest(manifest | null)` injects an
 * in-memory manifest, avoiding any disk I/O against the real file. Pass
 * `null` to clear the cache so the next call re-reads disk. Mirrors the
 * SWC-side helper exactly.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FugaziError, FugaziParseError, verifyWasmBlob } from '@fugazi/types';

export interface ManifestEntry {
  readonly path: string;
  readonly sha256: string;
}

export interface Manifest {
  readonly blobs: Readonly<Record<string, ManifestEntry>>;
}

// Resolve to <packages/extract>/wasm/manifest.json. import.meta.url at runtime
// points at <pkg>/dist/wasm/python/integrity.js (built) or <pkg>/src/wasm/
// python/integrity.ts (vitest), so we walk up THREE segments to reach the
// package root (vs two for the SWC-side module which lives one directory
// shallower).
const MANIFEST_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'wasm',
  'manifest.json',
);

let cachedManifest: Manifest | null = null;

async function loadManifest(): Promise<Manifest> {
  if (cachedManifest !== null) {
    return cachedManifest;
  }
  const text = await readFile(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(text) as Manifest;
  cachedManifest = parsed;
  return parsed;
}

/**
 * Verify the WASM blob registered under `blobKey` against its pinned SHA-256
 * in the manifest. Returns the absolute on-disk path of the verified blob
 * (resolved relative to `packageRoot`) on success.
 *
 * @throws FugaziParseError(code: 'WASM_MISSING') if the manifest has no entry
 *         for `blobKey`, OR if the blob path doesn't exist on disk.
 * @throws FugaziParseError(code: 'WASM_INTEGRITY') if the blob hash doesn't match.
 */
export async function verifyPythonWasmIntegrity(
  blobKey: string,
  packageRoot: string,
): Promise<string> {
  const manifest = await loadManifest();
  const entry = manifest.blobs[blobKey];
  if (entry === undefined) {
    throw new FugaziParseError({
      code: 'WASM_MISSING',
      message: `WASM blob '${blobKey}' is not registered in manifest`,
      context: { blobKey, manifestPath: MANIFEST_PATH },
    });
  }
  const blobPath = resolve(packageRoot, entry.path);
  try {
    await verifyWasmBlob(blobPath, entry.sha256);
  } catch (err) {
    if (err instanceof FugaziError && err.code === 'FS_PATH_NOT_FOUND') {
      throw new FugaziParseError({
        code: 'WASM_MISSING',
        message: `WASM blob not found at '${blobPath}'`,
        context: { blobKey, blobPath },
        cause: err,
      });
    }
    throw err;
  }
  return blobPath;
}

/**
 * Test-only escape hatch — inject an in-memory manifest (or pass `null` to
 * clear the cache so the next call re-reads disk).
 *
 * Not part of the public API surface: this symbol is named with a `__` prefix
 * to mark it as test-only, and is re-exported only from internal package
 * paths — never from the package's barrel `src/index.ts`.
 */
export function __setPythonManifestForTest(manifest: Manifest | null): void {
  cachedManifest = manifest;
}
