/**
 * @fugazi/extract — public package surface.
 *
 * Phase 3c.2 currently exposes the WASM integrity scaffolding (SC-19) and its
 * process-singleton loader. Test-only escape hatches (`__setManifestForTest`,
 * `__clearWasmCacheForTest`) are intentionally NOT re-exported here — tests
 * import them directly from the deep paths under `src/wasm/`.
 */

export { verifyWasmIntegrity, type Manifest, type ManifestEntry } from './wasm/integrity.js';
export { loadWasmModule } from './wasm/load.js';
