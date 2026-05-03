# @fugazi/mcp

Model Context Protocol server for [Fugazi](https://github.com/AP3X/fugazi).
Exposes the static-analysis toolkit to AI agents over stdio.

## Install

```bash
npm install @fugazi/mcp
```

## Usage

The MCP server is normally launched through the `fugazi-mcp` binary that ships
with the `fugazi` package. To embed it programmatically:

```ts
import { start } from '@fugazi/mcp';

start();
```

Tools exposed: `analyze`, `dead_code`, `dupes`, `health`, `audit`,
`boundaries`, `runtime_report`, `trace_file`, `trace_export`, `explain`,
`schema`, `init`, `coverage_setup`, plus mutating `fix_dry_run` / `fix_apply`.

## Documentation

See the [workspace README](https://github.com/AP3X/fugazi#readme) for the
complete tool reference.

## License

MIT
