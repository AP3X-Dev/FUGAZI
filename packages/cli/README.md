# fugazi

Codebase intelligence for TypeScript, JavaScript, and Python: dead code,
duplication, complexity, architecture drift, and runtime intelligence in a
single CLI. Mixed TS/Python monorepos are analyzed in one pass.

## Install

```bash
npm install -D fugazi
# or
bun add -d fugazi
```

## Usage

```bash
bunx fugazi              # run all analyses (works on .ts, .tsx, .js, .py, .pyi)
bunx fugazi dead-code    # only dead-code rules
bunx fugazi dupes        # duplication detection
bunx fugazi health       # complexity / maintainability
bunx fugazi watch        # watch mode
bunx fugazi fix --dry-run
```

Run against a Python project the same way:

```bash
cd my-flask-app/
bunx fugazi audit
```

See [`docs/PYTHON.md`](https://github.com/AP3X/fugazi/blob/main/docs/PYTHON.md)
for the Python-specific contract.

The package also ships two extra binaries:

- `fugazi-lsp` — Language Server Protocol implementation
- `fugazi-mcp` — Model Context Protocol server for AI agents

## Documentation

See the [workspace README](https://github.com/AP3X/fugazi#readme) for
configuration, rule reference, and integration guides.

## License

MIT
