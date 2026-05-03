# @fugazi/node

Programmatic Node API for [Fugazi](https://github.com/AP3X/fugazi) — the
TypeScript/JavaScript codebase intelligence toolkit.

## Install

```bash
npm install @fugazi/node
```

## Usage

```ts
import { analyze, findDupes, health, audit, traceFile, traceExport } from '@fugazi/node';

const result = await analyze({ root: process.cwd() });
console.log(result.issues);
```

The six exported functions cover the full analysis surface — dead code,
duplication, complexity health, audit (inventory only), and import tracing.

## Documentation

See the [workspace README](https://github.com/AP3X/fugazi#readme) for the
complete API reference.

## License

MIT
