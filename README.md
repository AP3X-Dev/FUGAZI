# Fugazi

Codebase intelligence for TypeScript, JavaScript, and Python. TS/Node port of [fallow](https://github.com/fallow-rs/fallow).

**Languages supported:** TypeScript / TSX, JavaScript / JSX, Python (`.py`, `.pyi`). Mixed TS+Python monorepos analyze in a single pass — the dispatcher routes each source file by extension and merges findings into one report. See [`docs/PYTHON.md`](docs/PYTHON.md) for the Python contract.

**Status: in implementation.** The repo is on its Phase 3 foundation pass; build commands run, but feature work is in progress and `bunx fugazi` does not yet produce real findings.

## Goal

Replace the Rust toolchain dependency of Fallow with a pure-TypeScript implementation that runs on Node 22+ and Bun, while preserving:

- Sub-second analysis on medium-sized codebases
- Whole-project understanding (module graph, re-export resolution, cross-reference)
- Full static layer (dead code, duplication, complexity, architecture drift)
- First-class runtime intelligence layer (hot/cold paths, runtime-weighted health, stale-flag evidence, trends, alerts)

All features are MIT-licensed.

## Quickstart

```bash
bun install
bun run build
bunx fugazi --help
```

Audit a TypeScript project:

```bash
cd my-ts-app/
bunx fugazi audit
```

Audit a Python project (Flask/FastAPI/Django/SQLAlchemy/pytest/Pydantic/Celery/Click and 16 more frameworks ship as built-in plugins):

```bash
cd my-flask-app/
bunx fugazi audit
```

The `bunx fugazi --help` output is sparse during the foundation phase; it becomes useful as Phase 3c–3f land.

## Building & Testing

From the repo root:

```bash
bun install         # install dependencies (npm install --workspaces also works)
bun run build       # turbo build across all packages
bun run typecheck   # tsc --noEmit across the workspace
bun run test        # vitest across all packages
bun run lint        # biome check
bun run dev:watch   # turbo build --watch + vitest --watch
bunx fugazi         # run the CLI against the current directory
```

Node-only contributors can substitute `npm install --workspaces && npm run build && npm test` — the CI matrix runs both lanes.

## Workspace structure

```
packages/
  types/         @fugazi/types        Shared TypeScript types
  config/        @fugazi/config       Configuration loading, schema, framework presets
  extract/       @fugazi/extract      AST extraction, parse cache, SFC handlers
  graph/         @fugazi/graph        Module graph, import resolution
  v8-coverage/   @fugazi/v8-coverage  V8 ScriptCoverage parser, line/col mapper
  core/          @fugazi/core         Analysis orchestration: dead code, dupes, health
  runtime/       @fugazi/runtime      Runtime-intelligence layer
  node-api/      @fugazi/node-api     Programmatic Node API
  cli/           fugazi               CLI binary (the one published package)
  lsp/           @fugazi/lsp          LSP server
  mcp/           @fugazi/mcp          MCP server for AI agent integration

editors/
  vscode/        VS Code extension (LSP client + tree views)
  zed/           Zed extension manifest

action/          GitHub composite Action
ci/              GitLab CI template
decisions/       Architecture Decision Records (ADRs)
docs/            Public docs source
fixtures/        Test fixtures (project, conformance, benchmarks)
plugins/         Framework presets (JSON + gated TS plugin tier)
```

The internal `@fugazi/*` packages are private and never published to npm. Only `fugazi` (from `packages/cli/`) is published; it bundles the workspace `dist/` outputs into a single ESM tarball. See ADR-015.

## Configuration

Fugazi reads (in priority order): `.fugazirc.json`, `fugazi.config.ts`, `fugazi.toml`. A workspace generates a starter config via `bunx fugazi init`. Schema reference is at `schema.json` and is regenerated from the Zod source via `bun tools/regen-schema.ts`.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development workflow, branch model, ADR process, and code conventions. Issues and security reports follow [`SECURITY.md`](SECURITY.md). All participants are expected to follow [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

MIT — see [`LICENSE`](LICENSE).

## Built with

- Bun (runtime + workspaces)
- Node 22+ (compatibility runtime)
- Turborepo (build orchestration)
- TypeScript 5.x
- Vitest + fast-check (testing)
- Biome (lint + format)
- oxc-parser-wasm (primary parser) and swc-wasm (fallback)
- msgpackr (cache encoding)
- Zod (schema validation)
- clipanion (CLI parser)
- tsup (VS Code extension bundle)
- vscode-languageserver (LSP)
