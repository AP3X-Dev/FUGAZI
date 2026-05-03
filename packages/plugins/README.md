# @fugazi/plugins

Declarative framework plugin system for Fugazi.

Ships 121 bundled plugins (Next.js, Vite, Vitest, Jest, ESLint, TypeScript,
Tailwind, Django, Flask, FastAPI, aiohttp, pytest, SQLAlchemy, SQLModel,
Alembic, Pydantic, polars, poetry, uv, etc.) as JSON data files validated
against `PluginDefSchema`. Plugins:

- mark framework convention files as entry points
- allow-list tooling dependencies (so they don't surface as `unused-deps`)
- declare which exports are framework-used per file pattern (so they don't
  surface as `unused-exports`)
- declare per-decorator allowlists for class members (Python, Phase 4d) so
  framework-driven dispatch (`@app.route`, `@pytest.fixture`) doesn't fire
  spurious `unused-class-members` findings

## Phase 4d — Python framework plugins

24 Python framework plugins ship in 4d:

| Family       | Plugins                                                   |
|--------------|-----------------------------------------------------------|
| Web          | django, flask, fastapi, starlette, tornado, pyramid      |
| Test         | pytest, unittest, hypothesis                             |
| ORM          | sqlalchemy, tortoise                                      |
| Validation   | pydantic, dataclasses, attrs                              |
| Async / queue| celery, rq, dramatiq                                      |
| CLI          | click, typer                                              |
| Tooling-only | black, isort, ruff, mypy, pyright                         |

Each Python plugin sets `packageManager: 'pip'` so its `enablers` are
checked against `pyproject.toml` / `setup.cfg` / `requirements.txt` instead
of `package.json`. The default `packageManager` is `'auto'` (both
manifests are consulted) so existing TS plugins are backwards-compatible.

### Deferred to v1.x (T355–T360)

- **Jupyter notebooks (`.ipynb`).** Notebook parsing is JSON-cell-aware and
  adds extraction complexity. The plugin shape is reserved.
- **Poetry / uv tooling-only plugins.** Per-resolver tooling allowlists
  beyond what pip's manifest already covers.
- **FastAPI extras, sqlmodel, polars.** Frameworks with thinner
  decorator/heritage surfaces; their declarative shape needs more
  ecosystem usage data before shipping.

## Public surface

```ts
import {
  PluginDef,
  loadBundledPlugins,
  getActivePlugins,
  detectActivePlugins,
  validatePlugin,
} from '@fugazi/plugins';
```

## v1 limitations (deferred)

- **AST-based config parsing.** The upstream Rust pipeline parses
  `vitest.config.ts` / `jest.config.ts` / `next.config.ts` etc. to extract
  `setupFiles`, `testMatch`, and `pageExtensions` from the AST. The TS port
  ships only the static `entryPoints` / `configPatterns` / `alwaysUsed` / 
  `usedExports` fields. Roughly 40 of the 91 plugins have a Rust
  `resolve_config()`; the porter records the static surface for those and
  flags them in the per-run port report. Dynamic resolution may be added in
  a later phase via per-plugin `resolveConfig` callbacks.
- **`ScopedUsedClassMember` heritage matching.** The schema accepts scoped
  rules (`extends` / `implements` heritage filters) but the v1 unused-class-
  members rule honours only flat `string` member-name entries. The current
  Inventory does not record class heritage, so heritage-constrained scoping
  is a no-op until that visitor enrichment lands.

Both limitations are documented contracts: the schema validates either form,
the loader preserves both, and the registry surfaces both. Downstream rules
silently ignore the deferred fields.
