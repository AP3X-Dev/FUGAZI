/**
 * @fugazi/extract — public package surface.
 *
 * Phase 3c.2 currently exposes the WASM integrity scaffolding (SC-19), its
 * process-singleton loader, the WASM parser adapter (Wave 5b-2), and the
 * fail-soft `scanFile` + `ScanErrorAggregator` (Wave 5b-4). Test-only escape
 * hatches (`__setManifestForTest`, `__clearWasmCacheForTest`) are intentionally
 * NOT re-exported here — tests import them directly from the deep paths under
 * `src/wasm/`.
 */

export { verifyWasmIntegrity, type Manifest, type ManifestEntry } from './wasm/integrity.js';
export { loadWasmModule } from './wasm/load.js';
export {
  parse,
  type ParseError,
  type ParseOptions,
  type ParseResult,
  type Program,
} from './parsers/oxc.js';
export {
  type IoScanError,
  type ParseFailedScanError,
  type ScanError,
  type UnsupportedLanguageScanError,
  pathNotFoundMessage,
  recognizedExtensions,
  unsupportedLanguageMessage,
} from './scan-error.js';
export { ScanErrorAggregator, scanFile, type ScanResult } from './parsers/scan.js';
export {
  CACHE_VERSION,
  encode as encodeCacheBlob,
  decode as decodeCacheBlob,
} from './cache/codec.js';
export {
  type CacheKeyParts,
  type ParseCacheStore,
  blobPathFor,
  createStore,
  deriveKey,
  read as readCache,
  write as writeCache,
} from './cache/store.js';
export type {
  CacheEntry,
  CacheHit,
  CacheMeta,
  CacheableResult,
} from './cache/types.js';
export { xxh3 } from './cache/hash.js';
export { type LockOptions, withLock } from './cache/lock.js';
export { type DispatchOptions, getCacheable } from './cache/dispatch.js';
export {
  buildInventory,
  type Declaration,
  type DeclarationKind,
  type Import,
  type ImportKind,
  type Inventory,
  type Usage,
  type UsageKind,
} from './visitor/index.js';
