/**
 * load.ts — process-singleton WASM module loader.
 *
 * Pipes through `verifyWasmIntegrity` for the SHA-256 + manifest check, then
 * compiles the bytes once and caches the resulting `WebAssembly.Module` per
 * `blobKey`. Subsequent calls return the cached module without re-reading or
 * re-compiling.
 *
 * If the verified path doesn't exist on disk (e.g. a mistakenly-pinned but
 * unshipped blob), throws `FugaziParseError(WASM_MISSING)` with the verbatim
 * message:
 *   `WASM blob not found at '<path>'`
 *
 * Test-only escape hatch: `__clearWasmCacheForTest()` empties the singleton
 * cache so the next call recompiles. Same convention as integrity.ts —
 * `__`-prefixed and not re-exported from the package barrel.
 */

import { readFile } from 'node:fs/promises';
import { FugaziParseError } from '@fugazi/types';
import { verifyWasmIntegrity } from './integrity.js';

// Minimal WebAssembly type surface — TypeScript ships these globals in
// lib.dom.d.ts / lib.webworker.d.ts, but our base tsconfig opts into ES2023
// only and pulling DOM into a Node-side package would cost ~6 MB of
// irrelevant browser types. The WebAssembly runtime is identical on Node ≥ 16,
// Bun, and browsers; we only reference `Module` and `compile` here.
interface MinimalWasmModule {
  readonly __wasmModuleBrand?: never;
}
interface MinimalWasmGlobal {
  compile(bytes: Uint8Array): Promise<MinimalWasmModule>;
}
declare const WebAssembly: MinimalWasmGlobal;
// Re-export the brand under the public name so the rest of the package
// (and tests) can reference `WebAssembly.Module` ergonomically.
export type WasmModule = MinimalWasmModule;

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

const moduleCache = new Map<string, MinimalWasmModule>();

/**
 * Load and compile the WASM blob registered under `blobKey`. Returns the
 * cached `WebAssembly.Module` on subsequent calls.
 *
 * @throws FugaziParseError(code: 'WASM_INTEGRITY') if the blob hash mismatches its pin.
 * @throws FugaziParseError(code: 'WASM_MISSING') if the manifest has no entry,
 *         or the verified path is absent on disk.
 */
export async function loadWasmModule(
  blobKey: string,
  packageRoot: string,
): Promise<MinimalWasmModule> {
  const cached = moduleCache.get(blobKey);
  if (cached !== undefined) {
    return cached;
  }

  const blobPath = await verifyWasmIntegrity(blobKey, packageRoot);

  let bytes: Buffer;
  try {
    bytes = await readFile(blobPath);
  } catch (cause) {
    if (isFileNotFound(cause)) {
      throw new FugaziParseError({
        code: 'WASM_MISSING',
        message: `WASM blob not found at '${blobPath}'`,
        context: { blobKey, blobPath },
        ...(cause instanceof Error ? { cause } : {}),
      });
    }
    throw cause;
  }

  const compiled = await WebAssembly.compile(bytes);
  moduleCache.set(blobKey, compiled);
  return compiled;
}

/**
 * Test-only escape hatch — clear the singleton compile cache. Not exported
 * from the package barrel.
 */
export function __clearWasmCacheForTest(): void {
  moduleCache.clear();
}
