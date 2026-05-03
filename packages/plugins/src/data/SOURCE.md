# Plugin Data — Source Attribution

The original 91 TypeScript/JavaScript JSON files in this directory are ported
from the upstream Fallow Rust project (MIT-licensed) at
`crates/core/src/plugins/*.rs`. Each file mirrors `PluginDefSchema` (the
canonical plugin shape).

The port is mechanical: a one-off Bun script at `tools/port-plugins.ts` reads
each Rust source file, extracts the static plugin surface (`enablers`,
`entryPoints`, `configPatterns`, `alwaysUsed`, `toolingDependencies`,
`usedExports`), and emits the JSON.

AST-based dynamic config parsing (`resolve_config()` in the Rust source) is
NOT ported in v1 — see the package README for the deferral rationale.

The porter is reproducible: re-running `bun tools/port-plugins.ts` regenerates
the upstream-derived TS plugins byte-for-byte.

## Phase 4d — Python framework plugins (24 files)

The 24 Python plugins (django, flask, fastapi, starlette, tornado, pyramid,
pytest, unittest, hypothesis, sqlalchemy, tortoise, pydantic, dataclasses,
attrs, celery, rq, dramatiq, click, typer, black, isort, ruff, mypy,
pyright) were authored fresh for this port — they do not exist in the
upstream Rust source, which is TS/JS-only. Each Python plugin sets
`packageManager: 'pip'` so its enablers route through the
`pyproject.toml` / `setup.cfg` / `requirements.txt` pipeline instead of
`package.json`. Many populate the new `usedDecorators` field
(`@app.route`, `@pytest.fixture`, etc.) so framework-driven dispatch
exempts the right class members from `unused-class-members`.

Original TS plugin source: https://github.com/fallow-rs/fallow (MIT)
