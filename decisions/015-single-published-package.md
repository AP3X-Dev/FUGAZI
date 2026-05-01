# ADR 015: Single published npm package (`fugazi`); no platform-specific binaries

## Status

Accepted

Date: 2026-04-30

## Context

The repo has 11 internal packages (`@fugazi/types`, `@fugazi/config`, `@fugazi/extract`, etc.). The naive distribution strategy is to publish each one to npm. The PRP rules this out: users should run `npm install -D fugazi` and get a working tool, not a chain of 11 dependencies they have to know by name.

Two distribution shapes were considered:

1. **Single ESM umbrella.** One published package (`fugazi`) that contains all internal package outputs in a `dist/` subtree. Users `npm install -D fugazi`; consumers of the programmatic API import from `fugazi/node` (or similar subpath exports).
2. **Platform-specific binaries.** A wrapper package (`fugazi`) that runs `postinstall` to download a precompiled binary for the user's platform. Common for Rust-ported tools.

Option 2 buys nothing for a TypeScript port: there's no native code to precompile. It also introduces postinstall network calls (firewall hostility), platform-detection bugs, and a release pipeline that has to publish four-plus tarballs per version.

## Decision

We publish a single ESM npm package named `fugazi`, sourced from `packages/cli/`. Internal packages stay `"private": true` and never reach npm.

The published tarball contains:

- `bin/fugazi.js`, `bin/fugazi-lsp.js`, `bin/fugazi-mcp.js` — five-line shebang shims that import from the bundled `dist/`.
- `dist/<package>/` for each internal package, copied in by a `prepublishOnly` script.
- `package.json` with `"exports"` mapping public subpaths (`fugazi/node`, etc.) to the right files.

WASM blobs (oxc-parser-wasm primary, swc-wasm fallback) are pulled in as transitive dependencies of the published package. Their `.wasm` files are not redistributed inside our tarball; they live in the user's `node_modules/oxc-parser-wasm/` etc. SHA-256 pins in `tools/wasm-pins.json` are checked at install via a `postinstall` script and at analyzer load.

There are no platform-specific binaries. Anything that varies by OS (path separator handling, line endings) is handled in TypeScript at runtime, not at install.

## Consequences

### Positive
- Users run `npm install -D fugazi` and the install completes with no native compilation, no platform-detection scripts, and no opaque binary downloads.
- Release flow publishes one tarball. CI is simpler; provenance attestation lives on a single artifact.
- Determinism extends to install: the same `package.json` + lockfile produces the same installed tree on every platform.

### Negative
- The published tarball is larger than a typical "one-package" tarball would be (it contains the build outputs of 11 internal packages). Measured size at v1.0 is well under typical thresholds.
- Subpath exports must stay stable across versions. We document the supported subpaths (`fugazi`, `fugazi/node`) and treat anything else as private.

### Neutral
- Internal packages can be split out and published individually later if there's a real ecosystem need. The decision is reversible without breaking users (we keep `fugazi` as the umbrella and add scoped packages alongside).

## References

- PRP `H1`, `SC-23`
- Spec `§6.A`, `§11.F`
- ADR-008 (workspaces), ADR-009 (Turbo)
