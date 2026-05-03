# @fugazi/lsp

Language Server Protocol implementation for
[Fugazi](https://github.com/AP3X/fugazi). Surfaces dead-code, duplication, and
complexity diagnostics inside any LSP-compatible editor.

## Install

```bash
npm install @fugazi/lsp
```

## Usage

The LSP server is normally launched through the `fugazi-lsp` binary that ships
with the `fugazi` package. To embed the server programmatically:

```ts
import { start, createServer } from '@fugazi/lsp';

start(); // boot stdio server
```

## Documentation

See the [workspace README](https://github.com/AP3X/fugazi#readme) for editor
integration guides.

## License

MIT
