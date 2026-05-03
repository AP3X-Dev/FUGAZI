# Fugazi for Zed

Status: **v1.0 scaffold only.** The Rust shim (`src/lib.rs`) that wires the
LSP binary into Zed's extension API is deferred to v1.x to avoid pulling a
Rust toolchain into the JavaScript-first build.

## Prereq

```
npm install -g fugazi
```

This puts `fugazi-lsp` on your PATH. Zed will pick it up via the manifest.

## Install

Manual install (until the extension is published):

```
# Linux / macOS
mkdir -p ~/.config/zed/extensions/fugazi
cp -R editors/zed/* ~/.config/zed/extensions/fugazi/

# Windows
xcopy editors\zed %APPDATA%\Zed\extensions\fugazi /E /I
```

Then restart Zed.

## Configuration

```toml
[language_servers.fugazi.configuration_options]
preset = "default"
format = "human"
```

## Status

| Surface | Status |
| --- | --- |
| Manifest (`extension.toml`) | shipped |
| Language file types | shipped |
| LSP binary registration | deferred to v1.x (Rust shim) |
| Automated tests | not in v1.0 (Zed has no headless extension test harness) |

See `test/manual-smoke.md` for the manual smoke procedure.
