# Fugazi for VS Code

Codebase intelligence for TypeScript and JavaScript projects: dead-code detection, duplication finding, complexity hotspots, architecture drift, and more.

The extension bundles the Fugazi LSP server. There is no separate download step and no `fugazi.lspPath` configuration — the LSP starts directly from the extension's bundled `server/` directory.

## Features

- Diagnostics for unused files, exports, dependencies, types, enum members, class members, unresolved imports, duplicate exports, circular dependencies, boundary violations, code duplication, complexity hotspots.
- Three tree views: Issues, Duplicates, Health.
- Status bar with pass/fail glyph and finding count.
- Code lens on every file with a finding count and an `Apply Fix` action.
- Code actions for inline `fugazi-ignore-next-line` and `fugazi-ignore-file` suppressions.

## Commands

- `Fugazi: Run Analysis` — re-runs the audit on the open workspace.
- `Fugazi: Apply Fix` — applies the available autofix code action.
- `Fugazi: Open Issue` — jumps to a finding from the tree view.
- `Fugazi: Toggle Hot Paths` — switches the runtime-evidence overlay on/off.

## Configuration

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `fugazi.preset` | `default` \| `ci` \| `strict` | `default` | Analysis preset bundle. |
| `fugazi.format` | one of human / human-plain / json / sarif / compact / markdown / codeclimate | `human` | Default output format for the manual run-analysis command. |
| `fugazi.severityOverrides` | object | `{}` | Per-rule severity overrides; keys are rule IDs, values are `error` / `warn` / `off`. |

There is intentionally no auto-download key and no LSP path key — the LSP ships inside the extension.

## Build

```
bun install
bun run build
```

`build.ts` copies `packages/lsp/dist/**` into `editors/vscode/server/`, then bundles `src/extension.ts` into `dist/extension.js` via tsup.

## Packaging

`vsce package` produces a `.vsix`. The target size is < 5 MB. If `vsce` is not installed locally, install it with `npm install -g @vscode/vsce` and run `vsce package` from this directory.

## Test status

Smoke tests in `test/` are written against `@vscode/test-electron`. They are intentionally skipped in CI on environments where the headless VS Code download is unreliable; manual smoke instructions live in `test/manual-smoke.md`.
