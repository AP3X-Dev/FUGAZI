# Zed extension manual smoke test

The Zed extension is **scaffold-only** in v1.0 — the manifest is committed but
the Rust shim that registers the LSP binary is deferred to v1.x (see README).

## Prereqs

- Zed 0.150 or newer
- `npm install -g fugazi` so `fugazi-lsp` is on PATH

## Steps

1. Copy `editors/zed/` to `~/.config/zed/extensions/fugazi/` (Linux/macOS) or
   `%APPDATA%\Zed\extensions\fugazi\` (Windows).
2. Restart Zed.
3. Open any TypeScript file.
4. Confirm Zed reports "Fugazi: language server starting".
5. Wait for "Fugazi: ready", then introduce an unused export.
6. Confirm a diagnostic appears within 2 seconds.

## Failure modes

- "language server starting" never resolves to "ready": the Rust shim has not
  been compiled yet. v1.0 ships scaffold-only; install Fugazi globally and run
  `fugazi-lsp` directly to confirm the LSP works outside Zed in the meantime.
