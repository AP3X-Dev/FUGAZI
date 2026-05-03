# fugazi

Codebase intelligence for TypeScript and JavaScript: dead code, duplication,
complexity, architecture drift, and runtime intelligence in a single CLI.

## Install

```bash
npm install -D fugazi
# or
bun add -d fugazi
```

## Usage

```bash
bunx fugazi              # run all analyses
bunx fugazi dead-code    # only dead-code rules
bunx fugazi dupes        # duplication detection
bunx fugazi health       # complexity / maintainability
bunx fugazi watch        # watch mode
bunx fugazi fix --dry-run
```

The package also ships two extra binaries:

- `fugazi-lsp` — Language Server Protocol implementation
- `fugazi-mcp` — Model Context Protocol server for AI agents

## Documentation

See the [workspace README](https://github.com/AP3X/fugazi#readme) for
configuration, rule reference, and integration guides.

## License

MIT
