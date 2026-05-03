/**
 * python/load.ts — process-singleton loader for the tree-sitter-python WASM
 * runtime (Phase 4a T301).
 *
 * Pipes through `verifyPythonWasmIntegrity` for the SHA-256 + manifest check,
 * reads the verified blob into memory, then asks `web-tree-sitter` to:
 *   1. boot its emscripten runtime exactly once per process (`Parser.init`),
 *   2. compile the language WASM into a `Parser.Language`,
 *   3. construct a `Parser` instance with the language already set.
 *
 * The compiled `Language` is cached per `blobKey`; subsequent calls return a
 * NEW `Parser` (cheap; web-tree-sitter parsers carry per-instance scratch
 * state) bound to the cached language. The fact-of-init for the emscripten
 * runtime is also cached — `Parser.init()` is only invoked on the first call.
 *
 * If the verified path doesn't exist on disk (e.g. a mistakenly-pinned but
 * unshipped blob), throws `FugaziParseError(WASM_MISSING)` with the verbatim
 * message:
 *   `WASM blob not found at '<path>'`
 *
 * Test-only escape hatch: `__clearPythonWasmCacheForTest()` empties the
 * singleton caches (language + init flag) so the next call re-initializes.
 * Same convention as the SWC-side loader — `__`-prefixed and not re-exported
 * from the package barrel.
 */

import { readFile } from 'node:fs/promises';
import { FugaziParseError } from '@fugazi/types';
import Parser from 'web-tree-sitter';
import { verifyPythonWasmIntegrity } from './integrity.js';

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

const languageCache = new Map<string, Parser.Language>();
let initPromise: Promise<void> | null = null;

async function ensureParserInit(): Promise<void> {
  if (initPromise !== null) {
    await initPromise;
    return;
  }
  initPromise = Parser.init();
  await initPromise;
}

/**
 * Load and instantiate the tree-sitter WASM runtime + language registered
 * under `blobKey`. Returns a fresh `Parser` already bound to the language.
 * The compiled `Language` is cached for the process lifetime.
 *
 * @throws FugaziParseError(code: 'WASM_INTEGRITY') if the blob hash mismatches its pin.
 * @throws FugaziParseError(code: 'WASM_MISSING') if the manifest has no entry,
 *         or the verified path is absent on disk.
 */
export async function loadPythonParser(blobKey: string, packageRoot: string): Promise<Parser> {
  const blobPath = await verifyPythonWasmIntegrity(blobKey, packageRoot);

  let bytes: Uint8Array;
  try {
    const buf = await readFile(blobPath);
    // Defensive copy — readFile returns a Node Buffer; web-tree-sitter accepts
    // Uint8Array. The two share the underlying ArrayBuffer, so no copy is
    // strictly required, but typing it as Uint8Array matches the loader's
    // declared parameter shape.
    bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
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

  await ensureParserInit();

  let language = languageCache.get(blobKey);
  if (language === undefined) {
    language = await Parser.Language.load(bytes);
    languageCache.set(blobKey, language);
  }

  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

/**
 * Load the language WASM from a caller-supplied byte array, skipping the
 * on-disk read AND the integrity gate. Used only by the in-memory tamper
 * test in `python/__tests__/integrity.test.ts`, which needs to demonstrate
 * that bytes-NOT-matching-the-pin reach the integrity layer and are rejected
 * before they ever make it into a Parser.
 *
 * Implementation note: this helper bypasses the integrity check by design —
 * its contract is "given these bytes, hand me a Parser". The integrity gate
 * is exercised in the public `loadPythonParser` path via
 * `verifyPythonWasmIntegrity`. Marked `__` to keep it off the package barrel.
 */
export async function __loadPythonParserFromBytesForTest(bytes: Uint8Array): Promise<Parser> {
  await ensureParserInit();
  const language = await Parser.Language.load(bytes);
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

/**
 * Test-only escape hatch — clear the singleton caches. Not exported from the
 * package barrel.
 */
export function __clearPythonWasmCacheForTest(): void {
  languageCache.clear();
  initPromise = null;
}
