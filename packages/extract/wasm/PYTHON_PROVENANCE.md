# tree-sitter-python.wasm — provenance

This blob is vendored into the Fugazi source tree so the package ships a
deterministic, hash-pinned Python parser without requiring `npm install`-time
emscripten or a Rust toolchain.

## Source

- **Upstream package:** [`tree-sitter-wasms`](https://www.npmjs.com/package/tree-sitter-wasms)
- **Upstream version:** `0.1.13`
- **Upstream tarball SHA-1:** `0502852881d40d0af5720f11d75b348796d8ce20`
- **Upstream license:** Unlicense (public domain — fully redistributable)
- **Upstream repo:** https://github.com/Gregoor/tree-sitter-wasms

The `tree-sitter-wasms` package builds prebuilt WASM blobs for many tree-sitter
language grammars using `tree-sitter-cli` 0.20.8 in CI. We extract a single
file (`out/tree-sitter-python.wasm`) and check it into this directory.

## File pin

- **Path:** `packages/extract/wasm/tree-sitter-python.wasm`
- **Bytes:** 476,105
- **SHA-256:** `9056d0fb0c337810d019fae350e8167786119da98f0f282aceae7ab89ee8253b`

The pin is enforced from two places sharing the same hash:

1. `packages/extract/wasm/manifest.json` — load-time integrity check (parser).
2. `tools/wasm-pins.json` — install-time integrity check (`bun tools/verify-wasm.ts`).

## Grammar version

The upstream package's `package.json` declares `tree-sitter-python: ^0.21.0`;
the WASM was built from that grammar with `tree-sitter-cli@0.20.8`. The
runtime is `web-tree-sitter@0.24.5` — its loader is backwards-compatible with
WASMs built by 0.20.x CLI (smoke-tested as part of T301).

## Refreshing this blob

When updating the grammar:

1. `npm pack tree-sitter-wasms@<new-version>` and extract `package/out/tree-sitter-python.wasm`.
2. Replace the file at `packages/extract/wasm/tree-sitter-python.wasm`.
3. Recompute SHA-256: `sha256sum packages/extract/wasm/tree-sitter-python.wasm`.
4. Update both manifest entries (`packages/extract/wasm/manifest.json`,
   `tools/wasm-pins.json`) with the new hash.
5. Bump the version + provenance fields in this file.
6. Run `bun tools/verify-wasm.ts` and `bun run test` — both must stay green.

## Why not vendor `web-tree-sitter` similarly?

`web-tree-sitter` is the JavaScript runtime; it lives in `node_modules`. We
only vendor language grammar WASMs (the static-data side) and let the JS
runtime install normally.
