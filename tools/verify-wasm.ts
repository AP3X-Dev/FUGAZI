#!/usr/bin/env bun
/**
 * verify-wasm.ts — verify pinned WASM blob hashes match on-disk content.
 *
 * Delegates to `verifyAllPinned` in `@fugazi/types` (single source of truth,
 * shared with the parser load-time check in Phase 3c). Reads
 * `tools/wasm-pins.json` (a flat object mapping path -> sha256 hex), streams
 * each file through `createHash('sha256')`, and exits 1 with a verbatim error
 * message on first mismatch. Empty pins -> exit 0 silently.
 *
 * Verbatim mismatch message (CONTRACT — must match `verifyWasmBlob`):
 *   `WASM integrity check failed for <path>: expected <pinned-hash>, got <actual-hash>`
 */

import { verifyAllPinned } from '../packages/types/src/wasm-verify.js';

const PINS_PATH = 'tools/wasm-pins.json';

try {
  await verifyAllPinned(PINS_PATH);
} catch (err) {
  if (err instanceof Error) {
    console.error(err.message);
  } else {
    console.error(String(err));
  }
  process.exit(1);
}
