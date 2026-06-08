# Contributing to Fugazi

Thanks for your interest. This document describes the development workflow, conventions, and review expectations.

## Quick start

```bash
git clone https://github.com/<your-fork>/fugazi.git
cd fugazi
bun install
bun run build
bun run test
```

If you don't have Bun, `npm install --workspaces && npm run build && npm test` works equivalently. CI runs both lanes; please keep both passing.

Common commands:

```bash
bun run typecheck   # tsc --noEmit across the workspace
bun run lint        # biome check
bun run dev:watch   # turbo build --watch + vitest --watch
```

## Branch model

- Work happens on feature branches off `main`. Branch names use the form `<type>/<short-slug>`, e.g. `feat/dead-code-bfs`, `fix/parser-eof-edge`.
- Pull requests target `main`. The repository uses **squash-merge** so the PR title becomes the merged commit subject — write it as a Conventional Commit.
- A PR is mergeable when:
  - The CI matrix is green (build, typecheck, lint, test, conformance, determinism, npm-compat lane).
  - The `forbidden:strings` and `forbidden:env` checks pass.
  - At least one approving review on substantive changes.
- Direct pushes to `main` are blocked.

## Commit messages: Conventional Commits

Use one of: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, `perf:`, `build:`, `ci:`, `style:`. The PR title (which becomes the squash-merge subject) follows the same convention. Body lines are wrapped at 100 columns.

Examples:

```
feat(graph): reverse-edge index for cross-reference queries
fix(extract): handle CRLF in template literal line counts
docs(adr): record clipanion choice as ADR-013
```

Write commit messages in plain, descriptive developer voice — no tool-generated trailers.

## ADR workflow

Architecture Decision Records live in `decisions/`. To propose a new one:

1. Copy `decisions/000-template.md` to `decisions/<NNN>-<kebab-slug>.md` where `<NNN>` is the next sequential number.
2. Fill in Status, Context, Decision, Consequences (Positive / Negative / Neutral). Length: 30–80 lines.
3. Open the PR with `docs(adr):` prefix and link the ADR from the PR body.
4. Once merged, the ADR is the canonical reference; update later only by adding a new ADR that supersedes it (set the old ADR's Status to `Superseded by ADR-<XXX>`).

Architecture changes must land with their ADR in the same PR — code review checks that the prose and the diff agree.

## Testing

- Test runner: **Vitest**. Each package has a minimal `vitest.config.ts`; the root `vitest.workspace.ts` collects them.
- Unit tests live next to source as `<file>.test.ts` or under `src/**/__tests__/`.
- Property-based tests use **fast-check**. Reach for them when invariants matter — file-id determinism, re-export termination, cycle detection.
- The conformance suite lives at `fixtures/conformance/` and is run via `bun run test:conformance`.
- TDD discipline is in force: failing test first, implementation second. The CI byte-diff gate runs the analyzer twice on the same input and diffs output to catch determinism regressions.

Run a single package's tests:

```bash
bun x vitest run --project @fugazi/extract
```

## Code style

- **Biome** handles both lint and format. There is no separate Prettier or ESLint configuration. Rules are in `biome.json`.
- TypeScript settings (in `tsconfig.base.json`):
  - `strict: true`
  - `noExplicitAny: true` (Biome rule)
  - `verbatimModuleSyntax: true`
  - `exactOptionalPropertyTypes: true`
- Imports are sorted by Biome's `organizeImports`. Use `import type` for type-only imports; the Biome rule will flag mistakes.
- Errors derive from `FugaziError` (defined in `@fugazi/types`) and use the `code` + `help` + `context` shape. Subclass per package: `FugaziConfigError`, `FugaziParseError`, etc.
- No `Math.random` in hot paths. Sort on emit. Keep iteration order deterministic. (Determinism is enforced by a CI byte-diff gate, not just convention.)

**Lefthook** runs Biome and a typecheck on staged files at commit time. Install hooks via `bun x lefthook install` (the `postinstall` script runs this automatically on `bun install`).

## Reporting issues

- Bugs: open a GitHub Issue using the `bug` template. Include `bunx fugazi --version`, the command you ran, the unredacted output (or a redacted excerpt), and a minimal reproduction if possible.
- Security: see [`SECURITY.md`](SECURITY.md). Do not file public issues for vulnerabilities — follow the disclosure process described there.
- Feature requests: open a Discussion first. Once the shape is agreed, an Issue tracks the implementation.

All interactions are governed by [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Release process

Releases are cut from `main` by maintainers. The release script (`tools/bump-version.ts`) handles version bump, changelog regeneration, and tag creation. Provenance attestation runs in `.github/workflows/release.yml`.

Contributors do not need to think about releases for normal PRs — write the change, add the test, write the ADR if applicable, and the release flow handles the rest.
