# Plugin Data — Source Attribution

The 91 JSON files in this directory are ported from the upstream Fallow Rust
project (MIT-licensed) at `crates/core/src/plugins/*.rs`. Each file mirrors
the canonical `plugin-schema.json` (also published by Fallow).

The port is mechanical: a one-off Bun script at `tools/port-plugins.ts` reads
each Rust source file, extracts the static plugin surface (`enablers`,
`entryPoints`, `configPatterns`, `alwaysUsed`, `toolingDependencies`,
`usedExports`), and emits the JSON.

AST-based dynamic config parsing (`resolve_config()` in the Rust source) is
NOT ported in v1 — see the package README for the deferral rationale.

The porter is reproducible: re-running `bun tools/port-plugins.ts` regenerates
this directory byte-for-byte.

Original project: https://github.com/fallow-rs/fallow (MIT)
