<p align="center">
  <img src="docs/assets/fugazi-banner.png" alt="Fugazi - codebase intelligence for TypeScript, JavaScript, and Python" width="100%" />
</p>

# Fugazi

Fugazi is deterministic codebase intelligence for TypeScript, JavaScript, and
Python projects. It builds a whole-project model of your source tree, runs
analysis rules against the resolved module graph, and reports the kind of
issues that usually survive normal test suites: dead code, dependency drift,
duplicate logic, circular imports, boundary violations, and complexity
hotspots.

The same analyzer powers the CLI, Node API, Language Server, MCP server, editor
extensions, and CI integrations. Output is designed to be stable enough for CI:
the same input should produce the same findings in the same order.

## What Fugazi Finds

### Dead Code And Import Hygiene

- Unused files, exports, types, enum members, class members, and dependencies.
- Unused `dependencies`, `devDependencies`, and `optionalDependencies`.
- Unresolved imports, unlisted dependencies, and duplicate exports.
- Private types that leak through a public API surface.
- Framework-invoked files and exports are filtered through bundled framework
  plugins so convention-based code is not treated as dead by default.

### Architecture Drift

- Circular dependency detection with deterministic cycle reporting.
- Zone-based boundary checks, for example preventing `ui` from importing
  `db` directly.

### Duplication

- Exact clones and near-duplicates, including renamed, reordered, and
  near-miss clone families.

### Health

- Cyclomatic complexity findings.
- Cognitive complexity findings.
- A project health score through `fugazi health --score`.

### Runtime Evidence

The core and Node API can fold in V8 coverage data to identify hot paths, cold
code, missing coverage evidence, and runtime-weighted refactor targets. The CLI
also includes `fugazi coverage setup`, which prints runner-specific snippets
for capturing coverage from supported test runners.

## Supported Projects

Fugazi analyzes TypeScript, JavaScript, and Python in one pass.

- TS/JS: `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`.
- Python: `.py`, `.pyi`.
- Single-file/component handlers live in the extractor layer for formats such
  as Vue, Astro, MDX, and CSS modules.
- Python analysis is syntactic. It does not run CPython, mypy, or pyright.
- TypeScript analysis is syntactic. It does not require a TypeScript
  type-checker pass.

See [docs/PYTHON.md](docs/PYTHON.md) for the Python contract and known
limitations.

## Install

Fugazi is a Node 22+ package. Bun is the primary development runtime for this
repository, but the published CLI runs on Node.

```bash
npm install -D fugazi
# or
bun add -d fugazi
```

Run it from a project root:

```bash
npx fugazi --help
npx fugazi init
npx fugazi dead-code
```

`fugazi` requires a subcommand. Use `fugazi --help` for the complete command
list.

## Docker

Build the local CLI image:

```bash
docker build -t fugazi .
```

Run it against the current project by mounting that project at `/workspace`:

```bash
docker run --rm -v "$PWD:/workspace" fugazi dead-code --format compact
docker run --rm -v "$PWD:/workspace" fugazi health --score
```

The image defaults to the `fugazi` entrypoint. The `fugazi-lsp` and
`fugazi-mcp` wrappers are also installed in the image for editor and agent
integrations.

For MCP clients, run the image with the `fugazi-mcp` entrypoint over stdio and
mount the project at `/workspace`:

```json
{
  "mcpServers": {
    "fugazi": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-v",
        "/absolute/path/to/project:/workspace:ro",
        "--entrypoint",
        "fugazi-mcp",
        "fugazi"
      ]
    }
  }
}
```

Use `projectRoot: "/workspace"` in MCP tool arguments. Keep the mount read-only
for analysis tools; remove `:ro` when intentionally using mutating tools such
as `init` or `fix_apply`.

## CLI

Common commands:

| Command | Purpose |
| --- | --- |
| `fugazi init` | Write a starter `.fugazirc.json` for the current project. |
| `fugazi dead-code` | Run the dead-code and import-hygiene rule family. |
| `fugazi unused-files` | Run only the unused-files rule. |
| `fugazi unused-exports` | Run only the unused-exports rule. |
| `fugazi unused-types` | Run only the unused-types rule. |
| `fugazi unused-deps` | Run dependency usage rules. |
| `fugazi circular-deps` | Run only circular dependency detection. |
| `fugazi boundaries` | Run only architecture boundary checks. |
| `fugazi dupes` | Run duplicate-code detection. |
| `fugazi health` | Run complexity and maintainability rules. |
| `fugazi health --score` | Print only the integer project health score. |
| `fugazi audit` | Build and print inventory/metrics without diagnostics. |
| `fugazi trace --file <path>` | Show importers for a file. |
| `fugazi trace --export <name>` | Show importers for a named export. |
| `fugazi explain <rule-id>` | Explain a rule and how to suppress it. |
| `fugazi schema` | Print the configuration JSON schema. |
| `fugazi schema --markdown` | Print the configuration schema as Markdown. |
| `fugazi coverage setup` | Print supported coverage-capture snippets. |
| `fugazi fix --dry-run` | Preview available machine-applicable fixes. |
| `fugazi fix` | Apply available machine-applicable fixes. |
| `fugazi watch` | Re-run analysis when source files change. |

Analysis commands support:

```bash
fugazi dead-code --format json --quiet
fugazi dead-code --format sarif
fugazi dead-code --preset ci
```

Formats: `human`, `human-plain`, `json`, `sarif`, `compact`, `markdown`, and
`codeclimate`.

Exit behavior:

- `0`: no error-severity findings.
- `1`: error-severity findings were reported.
- `2`: usage or configuration error.

`--preset ci` selects plain output, suppresses progress noise, and fails when
any finding is present.

## Configuration

The CLI currently auto-loads `.fugazirc.json` from the project root. Run
`fugazi init` to create the starter file, and run `fugazi schema --markdown`
for the full field reference.

Minimal example:

```jsonc
{
  "entrypoints": ["src/index.ts", "src/cli.ts"],
  "rules": {
    "unused-files": "error",
    "code-duplication": "warn",
    "unused-dev-deps": "off"
  },
  "zones": {
    "ui": {
      "pattern": ["src/ui/**"],
      "canImport": ["domain"]
    },
    "domain": {
      "pattern": ["src/domain/**"],
      "canImport": []
    }
  },
  "health": {
    "cyclomaticThreshold": 10,
    "cognitiveThreshold": 15
  }
}
```

Every rule resolves to `error`, `warn`, or `off`. Inline suppressions are
available in TS/JS and Python:

```ts
// fugazi-ignore-next-line unused-exports
export const keptForReflection = true;

// fugazi-ignore-file unused-files
```

```python
# fugazi-ignore-next-line unused-exports
def kept_for_reflection():
    return True
```

See [CONVENTIONS.md](CONVENTIONS.md) for analyzer behavior and determinism
rules.

## Programmatic API

Install the API package when you want structured analysis results in another
tool:

```bash
npm install @fugazi/node
```

```ts
import { analyze, audit, findDupes, health, traceExport, traceFile } from '@fugazi/node';

const result = await analyze({
  projectRoot: process.cwd(),
  rules: 'all',
});

for (const issue of result.issues) {
  console.log(`${issue.severity} ${issue.kind} ${issue.file}: ${issue.message}`);
}
```

The public functions are `analyze`, `findDupes`, `health`, `audit`,
`traceFile`, and `traceExport`.

## Editor And Agent Surfaces

| Surface | Package or path | Notes |
| --- | --- | --- |
| CLI | `fugazi` | Main command-line interface. |
| Node API | `@fugazi/node` | Structured API for tools and custom automation. |
| LSP | `fugazi-lsp` / `@fugazi/lsp` | Editor diagnostics, hovers, code actions, and code lens. |
| MCP | `fugazi-mcp` / `@fugazi/mcp` | Model Context Protocol server for AI agents over stdio. |
| VS Code | `editors/vscode/` | Extension that bundles the LSP server. |
| Zed | `editors/zed/` | Manifest scaffold that uses `fugazi-lsp` on PATH. |
| GitHub Actions | `action/` | Composite action with annotations, PR comments, and SARIF upload support. |
| GitLab CI | `ci/` | Template for Code Climate output and merge request notes. |

## How It Works

The analyzer pipeline is shared by every surface:

```text
discover -> extract -> graph -> analyze -> cross-reference -> runtime
```

- `discover` enumerates supported source files and applies excludes.
- `extract` parses files into declarations, imports, exports, usages, and
  complexity metrics.
- `graph` resolves module edges and re-export chains.
- `analyze` runs enabled rules against the graph.
- `cross-reference` removes redundant findings and applies framework-plugin
  knowledge.
- `runtime` is optional and runs only when coverage evidence is supplied.

The design is intentionally fail-soft. Parse errors are collected and reported
as metrics; one bad file should not take down the whole analysis run.

For the detailed design, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository Layout

```text
packages/
  types/         shared public types
  config/        configuration schema, loaders, framework detection
  extract/       AST extraction, usage inventory, complexity metrics
  graph/         module graph and import resolution
  v8-coverage/   V8 coverage parsing and rebasing
  core/          analysis pipeline, rules, reporters, runtime integration
  runtime/       runtime-intelligence report assembly
  node-api/      @fugazi/node
  cli/           fugazi CLI and bundled binaries
  lsp/           @fugazi/lsp
  mcp/           @fugazi/mcp
  plugins/       bundled framework plugins

editors/         VS Code and Zed integrations
action/          GitHub composite action
ci/              GitLab CI template
docs/            architecture, Python support, release docs
tests/           conformance, fixtures, regression, and ecosystem tests
```

## Development

From the repository root:

```bash
bun install
bun run build
bun run typecheck
bun run test
bun run lint
```

Useful scripts:

```bash
bun run fugazi:built -- dead-code --format compact
bun run dev:watch
bun run format
```

Node-only contributors can use npm workspaces for the main build and test
flow:

```bash
npm install --workspaces
npm run build
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch, commit, ADR, testing, and
review conventions.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - analyzer architecture and rule engine.
- [docs/PYTHON.md](docs/PYTHON.md) - Python support, framework plugins, and limitations.
- [docs/RELEASE.md](docs/RELEASE.md) - release process.
- [docs/V1_LIMITATIONS.md](docs/V1_LIMITATIONS.md) - current v1 limitations.
- [SECURITY.md](SECURITY.md) - private vulnerability reporting.

## License

MIT. See [LICENSE](LICENSE).
