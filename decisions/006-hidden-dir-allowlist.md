# ADR 006: Hidden-directory allowlist (5 entries, hardcoded)

## Status

Accepted

Date: 2026-04-30

Background: Fugazi maintains a fixed list of five hidden directories and the principle of refusing to grow it without an explicit follow-up ADR.

## Context

The file walker has to decide, for each directory it encounters, whether to descend or skip. Hidden directories (those whose name starts with `.`) are dangerous on both sides:

- **If we always descend**, we walk into `.git/` (gigabytes), `.next/` (build artifacts), `.cache/`, `.turbo/`, `node_modules/.bin/`, and a long tail of tool caches. Findings explode, performance collapses, and reports become useless.
- **If we always skip**, we miss real source code that lives in `.storybook/preview.tsx`, `.vitepress/config.ts`, `.changeset/*.md`, `.well-known/*.ts`, and `.github/workflows/*.ts` (yes, GitHub Actions written in TypeScript exist).

There is no syntactic rule that distinguishes "tool cache directory" from "source directory whose name begins with a dot." The only sound strategy is to enumerate.

## Decision

The walker maintains a hardcoded allowlist of five hidden directories:

- `.storybook`
- `.vitepress`
- `.well-known`
- `.changeset`
- `.github`

Any other dot-prefixed directory is skipped without recursion. Hidden *files* (e.g., `.eslintrc.js`, `.prettierrc.cjs`) are always discovered — the extension filter and language detector handle whether they participate in analysis.

The allowlist is a constant in `@fugazi/extract`. Adding to it requires a pull request that updates this ADR with the rationale for the new entry. Removing entries follows the same rule.

## Consequences

### Positive
- Zero per-project configuration: contributors never have to remember which hidden directories matter.
- Walking time is bounded; we never accidentally descend into `.git/objects/pack/` or a multi-GB `.cache/`.
- The allowlist is small enough to memorize and self-test (we ship an exhaustiveness test that asserts list length, uniqueness, dot-prefix, no trailing slash).

### Negative
- A user with source code in a sixth dot-directory (`.somethingelse/`) cannot configure the walker to include it without patching the constant. We accept this; the cure (per-project hidden-dir config) is worse than the disease (rare workaround needs a PR).
- If a community framework popularizes a new dot-directory convention (`.svelte-kit/`?), Fugazi has to ship an update before users see it. This is rare and acceptable.

### Neutral
- The allowlist is intentionally fixed and small. Keeping it stable simplifies cross-tool comparisons.

## References

- PRP FR-D1
- Spec `§3.E`
- Implementation: exhaustiveness test in `packages/extract/src/discover/__tests__/hidden-dirs.test.ts`
