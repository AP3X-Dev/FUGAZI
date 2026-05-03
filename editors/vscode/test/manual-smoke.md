# VS Code extension manual smoke test

These instructions cover the smoke-test surface that `@vscode/test-electron`
exercises automatically in CI. Run them locally before publishing a release.

## Prereqs

- VS Code 1.85 or newer
- `bun install && bun run build` finished from the repo root
- `bun run build` from `editors/vscode/` (produces `dist/extension.js` and `server/`)

## Steps

1. From VS Code, choose `File > Open Folder`, point it at `editors/vscode/`.
2. Press F5 (`Run > Start Debugging`) to launch the Extension Development Host.
3. In the new window, open any TypeScript project (the Fugazi repo itself works).
4. Confirm:
   - The "Fugazi: 0" status-bar item appears within ~2 seconds of opening a TS file.
   - The Issues / Duplicates / Health tree views appear under the Explorer panel.
   - The Output channel "Fugazi Language Server" prints `[server initialised]`.
5. Run command `Fugazi: Run Analysis` from the command palette.
6. Confirm:
   - Findings populate in the Issues tree.
   - The status-bar count updates.
   - At least one finding has a code-lens with an `Apply Fix` link.
7. Click `Apply Fix` on a code-lens. Confirm the suppression comment is inserted.

## Failure modes

- Status bar stays "Fugazi: 0" but Output panel is empty: the LSP failed to
  start. Check `editors/vscode/server/fugazi-lsp.js` exists and is syntactically valid.
- Tree views are empty: the custom requests `fugazi/listClones` /
  `fugazi/listHealthFindings` were not handled by the server. Confirm the
  current LSP build wires them.
