# Fugazi release runbook

The release pipeline is the existing `.github/workflows/release.yml`, which
fires on tag pushes matching `v*` and runs `bun install`, `bun run build`,
`bun run test`, then `npm publish` from `packages/cli/`.

This runbook documents the **manual prerequisite changes** that must be
applied before the first publishable release (`v0.1.0-rc.1`). The current
workspace deliberately keeps every package marked `private: true` until we
explicitly opt in. None of the changes below have been applied automatically.

## Packages that should be public

| Workspace path | npm name | Notes |
| --- | --- | --- |
| `packages/cli` | `fugazi` | The single user-facing CLI package per FR-O1 / H1. Contains `bin/fugazi`, `bin/fugazi-lsp`, `bin/fugazi-mcp`. |
| `packages/node-api` | `@fugazi/node` | Programmatic Node API. Currently named `@fugazi/node-api` in `package.json`; rename to `@fugazi/node` at publish. |
| `packages/lsp` | `@fugazi/lsp` | Standalone LSP server (also reachable through `fugazi-lsp` shim). |
| `packages/mcp` | `@fugazi/mcp` | MCP server. |
| `packages/plugins` | `@fugazi/plugins` | Declarative plugin pack. |

## Packages that stay private

`@fugazi/types`, `@fugazi/config`, `@fugazi/extract`, `@fugazi/graph`,
`@fugazi/v8-coverage`, `@fugazi/runtime`, `@fugazi/core`. These are
internal building blocks that are bundled / depended-on by the publishable
packages but should not appear on the npm registry.

## Required changes before `v0.1.0-rc.1`

For each publishable package above:

1. Set `"private": false`.
2. Bump `"version"` to `"0.1.0-rc.1"`.
3. Add `"publishConfig": { "access": "public" }` to scoped names (anything
   under the `@fugazi` org).
4. Add a `"files"` array listing only the dist artefacts plus `README.md` and
   `LICENSE`. Recommended starter:
   ```json
   "files": ["dist/", "README.md", "LICENSE"]
   ```
   (For `packages/cli` also include `bin/` so the npm shim is shipped.)
5. Add a `"repository"` field pointing at the GitHub URL.
6. Add a `"homepage"` and `"bugs.url"`.
7. For `@fugazi/node` only: change `"name"` from `@fugazi/node-api` to
   `@fugazi/node` (per FR-O1 user-facing naming).

## Why this is documented, not applied

- Flipping `"private": false` and bumping versions is irreversible once the
  tag is pushed; the user should perform the change themselves so the bump
  is visible in the diff.
- Renaming `@fugazi/node-api` → `@fugazi/node` would require a coordinated
  update to every internal `dependencies` entry that currently references
  `@fugazi/node-api`. The release pipeline can do this via a publish-time
  rename (`npm publish` after a `npm pkg set name=...`), but doing it in
  the repo creates churn in 4+ workspace packages.
- Setting `"version": "0.1.0-rc.1"` across 5 packages should happen in a
  single dedicated commit so the tag and the diff line up.

## Recommended publish flow

```
# 1. Apply all changes from the table above in a single commit
# 2. Tag and push
git tag v0.1.0-rc.1
git push origin v0.1.0-rc.1
```

The existing `release.yml` will run, build, test, and publish each
publishable package. The workflow currently only publishes
`packages/cli`; before tagging, extend it to publish the other four packages
in dependency order (types/config/extract/graph/core/runtime/v8-coverage are
private so they bundle into the consumers).

## Runtime evidence layer

Everything in `runtime-intelligence` (hot/cold paths, runtime-weighted
health, etc.) ships in the same `fugazi` package — there is no separate
release artefact and no opt-in toggle.
