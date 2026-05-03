# Ecosystem regression workflow

This directory contains the weekly ecosystem-regression sweep. It clones a
fixed list of 12 well-known TypeScript / JavaScript repositories, runs
`bunx fugazi audit --format json --quiet` against each, and asserts:

- exit code is 0 or 1 (0 = clean, 1 = findings present — both expected)
- no `fugazi crashed` marker in stderr
- wall-clock per project is at or below 60 s

The sweep runs:

- weekly via `.github/workflows/ecosystem.yml` cron `0 6 * * 1`
- on demand via `workflow_dispatch`
- never on PR builds (would require unbounded network and time)

## Local invocation

```sh
SKIP_ECOSYSTEM=0 bun tests/ecosystem/runner.ts
```

Without `SKIP_ECOSYSTEM=0`, `runner.ts` is a no-op — and the local Vitest
suite (`bun run test`) never invokes the network sweep.

## Adding or removing a repo

Edit `projects.json` and add or remove an entry. Every entry must declare:

- `org` — GitHub organisation
- `repo` — repository name
- `branch` — branch to clone (we use `--depth 1`)
- `subdir` — optional subdirectory inside the repo to run `fugazi` from
- `install_command` — best-effort install command; failures here do NOT abort
  the audit (Fugazi's syntactic analysis works without `node_modules`)

The shape is enforced by `__tests__/runner.test.ts`.

## How regressions are caught

The cron job uploads its JSON output to the run's artifacts. A regression in
the analyzer (panic, timeout, exit > 1) lights up at most one workday after
landing — much earlier than waiting for the next user bug report.

For the explicit-instance regression we still maintain unit tests in
`packages/<x>/src/__tests__/` and per-bug fixtures under `tests/regression/`
(see `regression-190-turborepo-subdir/`).
