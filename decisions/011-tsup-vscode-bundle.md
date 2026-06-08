# ADR 011: Use tsup to bundle the VS Code extension

## Status

Accepted

Date: 2026-04-30

## Context

Runtime packages in Fugazi ship as raw ESM `dist/` directories — no bundling, no minification (per spec §5.D and the H1 install-size constraint). The VS Code extension is the explicit exception: VS Code's loader requires a single bundled file at `editors/vscode/dist/extension.js`. We have to pick a bundler.

Candidates: `tsup` (esbuild-backed), `rolldown` (rollup-compatible, Rust-based), `rollup` directly, `esbuild` directly, and `webpack`.

Decision criteria: simple TS-aware config, fast incremental builds for the watch loop, predictable output that VS Code's tooling won't choke on, low maintenance burden.

## Decision

We use `tsup`. The configuration lives at `editors/vscode/tsup.config.ts` and is small enough to fit on one screen. tsup wraps esbuild with TypeScript-aware defaults and produces a single CommonJS or ESM file with sourcemaps.

The output `editors/vscode/dist/extension.js` is committed to a `.vsix` bundle by `vsce package` during the release flow. The bundled file targets the Node version currently shipped with stable VS Code.

Rolldown was the alternative and remains a viable swap target — it would produce a comparable artifact at comparable speed at our scale. tsup wins on simpler config and zero migration cost from existing Bun/Node setups; if Rolldown's TS support stabilizes ahead of tsup's, we revisit and write a follow-up ADR.

## Consequences

### Positive
- Configuration is short and reads cleanly. New contributors can edit `tsup.config.ts` without learning a bundler DSL.
- Build time is sub-second on a warm cache, supporting fast extension iteration.
- esbuild's output is well-understood by VS Code's debugger and source-map machinery.

### Negative
- tsup adds a development dependency that lives only in the `editors/vscode/` workspace. Acceptable; the surface is small.
- tsup is a thin wrapper, so when esbuild changes behavior (e.g., a new minification default), it can surface here. We pin tsup and esbuild explicitly to guard against drift.

### Neutral
- The Zed extension does not need a bundler — its registration code is small and ships unbundled. No bundler choice required for it.

## References

- Requirements: `H1`
- Spec `§5.D`
- ADR-008 (workspaces)
