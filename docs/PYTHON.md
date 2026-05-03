# Python support

Fugazi v1.0 analyzes pure-Python projects and mixed TS+Python monorepos
through the same `fugazi` CLI. Detection, parsing, resolution, and rule
evaluation run side by side with the TypeScript/JavaScript pipeline; the
report shape is unified across languages.

## Versions

- Supported Python: **3.10+**. 3.11+ recommended (uses the standard
  library list bundled in `packages/graph/src/resolve-py/stdlib.ts`).
- Parser: tree-sitter Python WASM. No CPython interpreter is invoked.
- Type checker: none. Fugazi performs **syntactic analysis only** — we
  do not run mypy, pyright, or any equivalent.

## File extensions

Discovery picks up:

- `.py` — runtime sources
- `.pyi` — type stubs

Inside a project tree, all matched files are dispatched through the
Python pipeline regardless of `include` glob (the cross-language
dispatcher in `packages/core/src/run-analysis.ts` routes by extension).

## Manifest formats

The Python resolver consults the following declarations to classify
imports as third-party vs unlisted:

- `pyproject.toml` (PEP 621 `[project]` + `[project.optional-dependencies]`)
- `pyproject.toml` (Poetry `[tool.poetry.dependencies]`)
- `pyproject.toml` (uv `[tool.uv]` extras)
- `setup.cfg` `[options]` `install_requires` block
- `setup.py` literal `install_requires=[...]` (non-literal forms are
  silently skipped — see Limitations)
- `requirements*.txt` (recursive `-r ./other.txt` includes are deferred)

The resolver chooses the first manifest it finds, walking up from each
source file towards the project root.

## Suppression syntax

Two forms, identical to the TypeScript pipeline:

```python
# fugazi-ignore-next-line unused-files
def maybe_unused():
    return 1
```

```python
# fugazi-ignore-file unused-class-members
class WholeFileExempt:
    ...
```

Inline comments are recognised whether they appear at module level, inside
class bodies, or inside function bodies. The legacy `fallow-ignore-*`
spellings remain supported for compatibility.

## Framework plugins

The Python plugin tier ships **24** declarative plugins (target was 30 —
the remaining 6 are deferred to v1.x; see Limitations). Each plugin can
contribute `entryPoints`, `alwaysUsed`, `configPatterns`, and
`usedDecorators`.

| Web frameworks | Test runners | Data / ORM | CLI / async / tooling |
|----------------|--------------|------------|------------------------|
| flask          | pytest       | sqlalchemy | click                  |
| fastapi        | unittest     | pydantic   | celery                 |
| django         | tox          | dataclasses| asyncio                |
| starlette      | nose2        | attrs      | typer                  |
| aiohttp        |              | marshmallow| invoke                 |
| tornado        |              |            | docopt                 |
| bottle         |              |            | argparse               |
| sanic          |              |            |                        |

(Names match the JSON files under `packages/plugins/dist/data/`.)

A plugin is *active* for a project when its `enablers` (e.g.
`["flask"]`) overlap the project's declared dependencies.

## Decorator-driven exemption

Each Python plugin lists `usedDecorators`. Any class member or
top-level function carrying one of these decorators is exempt from the
`unused-class-members` and `unused-exports` rules.

```python
# Flask plugin contributes "app.route" and "blueprint.route" to
# usedDecorators, so neither `home` nor `users` is flagged unused
# even when no other module imports them.

@app.route("/")
def home():
    return "home"

@bp.route("/users")
def users():
    return "users"
```

The decorator set is dotted-name-aware: `app.route`, `flask.app.route`,
and `blueprint.route` all match cleanly.

## TYPE_CHECKING handling

Imports inside an `if TYPE_CHECKING:` block emit `kind: 'type'` in the
Inventory. The graph layer does not follow type-only edges through the
module-reachability walk, so:

- Type-only imports never trigger `unused-files` against the imported
  module purely for type usage.
- `private-type-leak` and `unused-types` rules use the type-only
  classification to decide whether a name is part of the runtime API
  surface.

```python
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import User  # kind: 'type', not a runtime edge


def show(u: "User") -> str:
    return u.name
```

## `__all__` honoring

When a module defines `__all__ = [...]` with a list/tuple of string
literals, exports are restricted to that list. Names not present in
`__all__` emit `exported: false`.

```python
__all__ = ["public_one"]


def public_one():     # exported: true
    return 1


def hidden_two():     # exported: false (module would be considered to
    return 2          # not export this name even though no leading _)
```

Non-literal `__all__` shapes (e.g. `__all__ = some_function()` or
`__all__ += [...]` patterns) silently fall back to the underscore
heuristic — this is on the v1.x list.

## Mixed TS + Python monorepo

A single `fugazi` invocation analyzes both languages:

```
my-app/
  package.json
  pyproject.toml
  src/
    frontend/
      App.tsx
      hooks/useAuth.ts
    backend/
      manage.py
      views.py
```

```bash
cd my-app
bunx fugazi audit --format json
```

The report's `metrics.filesByLang` block shows per-language file counts;
`metrics.parseErrors.byLang` shows per-language parser errors. The
`activePlugins` list combines TS-side and Python-side plugins (e.g.
`["typescript", "react", "django"]`).

A worked example is committed at
`tests/fixtures/frameworks/mixed-py-ts/`.

## Limitations

The following are tracked in [`docs/V1_LIMITATIONS.md`](V1_LIMITATIONS.md):

- TYPE_CHECKING `else:` branch contents incorrectly type-classified.
- `bigint` literal not preserved in `Constant.value` (precision loss for
  huge ints).
- Comprehension target bindings folded into containing scope.
- `for` loop tuple-unpacking targets collapse to `''`.
- Non-literal `__all__` forms silently fall back.
- PEP 695 `type X = int` partial (regex desugar shipped; full grammar
  support deferred).
- `.ipynb` notebook parsing deferred.
- 24 plugins shipping; `sqlmodel`, `polars`, FastAPI extras, and
  `poetry` / `uv` tooling-only plugins deferred.
- Cross-file TYPE_CHECKING resolution deferred (the type/runtime
  classification is per-file today).
- Python version-aware stdlib list (currently fixed to 3.11).
- `requirements.txt` `-r recursive includes` deferred.
- `setup.py` non-literal `install_requires` silently skipped.
- Cache wiring not yet plumbed through `extractOne` for Python (cache
  helpers carry the `lang` field but the runtime path doesn't call
  them — both languages re-parse on every run).
- Per-language streaming progress events deferred (a single mixed loop
  emits progress today).
- `from .pkg import submodule` (relative-import chain through a
  package's `__init__.py`) does not always anchor to the right file
  when `__init__.py` is empty — known false positive on `unused-files`.
