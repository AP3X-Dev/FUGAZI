# Plugin Data

This directory contains 91 TypeScript/JavaScript JSON plugin definitions
(MIT-licensed). Each file mirrors `PluginDefSchema` (the canonical plugin
shape).

The definitions are generated mechanically: a one-off Bun script produces the
static plugin surface (`enablers`, `entryPoints`, `configPatterns`,
`alwaysUsed`, `toolingDependencies`, `usedExports`) and emits the JSON.

AST-based dynamic config parsing is NOT included in v1 — see the package
README for the deferral rationale.

The generator is reproducible: re-running it regenerates the plugin JSON
byte-for-byte.

## Phase 4d — Python framework plugins (24 files)

The 24 Python plugins (django, flask, fastapi, starlette, tornado, pyramid,
pytest, unittest, hypothesis, sqlalchemy, tortoise, pydantic, dataclasses,
attrs, celery, rq, dramatiq, click, typer, black, isort, ruff, mypy,
pyright) cover Python frameworks alongside the TS/JS set. Each Python plugin
sets `packageManager: 'pip'` so its enablers route through the
`pyproject.toml` / `setup.cfg` / `requirements.txt` pipeline instead of
`package.json`. Many populate the `usedDecorators` field
(`@app.route`, `@pytest.fixture`, etc.) so framework-driven dispatch
exempts the right class members from `unused-class-members`.
