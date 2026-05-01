# Fugazi

Codebase intelligence for TypeScript and JavaScript. TS/Node port of [fallow](https://github.com/fallow-rs/fallow).

**Status: pre-alpha.** Multi-pass design analysis is in progress — see [`clean-room/DESIGN_DOC.md`](clean-room/) (gitignored). No usable build yet.

## Goal

Replace the Rust toolchain dependency of Fallow with a pure-TypeScript implementation that runs on Node 22+ and Bun, while preserving:

- Sub-second analysis on medium-sized codebases
- Whole-project understanding (module graph, re-export resolution, cross-reference)
- Free static layer (dead code, duplication, complexity, architecture drift)
- Paid runtime intelligence layer (hot/cold paths, runtime-weighted health, etc.)

The static layer is MIT-licensed. The runtime layer is gated by license verification.

## Roadmap

See [`clean-room/COVERAGE.md`](clean-room/) for the full Phase 1/2/3 plan once analysis completes.
