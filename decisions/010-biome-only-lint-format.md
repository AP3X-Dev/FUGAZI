# ADR 010: Biome only for lint and format in v1.0 (no ESLint)

## Status

Accepted

Date: 2026-04-30

## Context

The spec lists "ESLint + Biome" as a stretch goal but does not require both at the same layer. Running both is the historical default in TypeScript projects: ESLint for richer rules, Prettier (now Biome) for formatting. Combined, however, they have problems: two tools means two config files, two caches, two version-pin points, and a non-trivial chance of conflicting rules.

Biome's lint coverage in 2026 includes the rules we care about for v1.0:

- `noUnusedImports`, `noUnusedVariables`
- `useImportType`, `useExportType` (verbatimModuleSyntax-friendly)
- `noNonNullAssertion`, `noExplicitAny`
- import organization
- formatting

Biome ships as a single npm dependency; no native compilation at install time on the supported platforms.

## Decision

Biome is the only lint+format tool in v1.0. Configuration lives at the repo root in `biome.json` with `linter.rules.recommended: true` plus the project-specific overrides documented in spec §4.B. Per-package overrides are permitted (rare; expected only for `extract` to relax rules around AST-builder helpers).

ESLint is not installed. If a future rule requires type-aware lint that Biome cannot express, we will revisit — that revisit produces a follow-up ADR. Because the project explicitly does not run `tsc` at runtime (ADR-001), the most common reason to need ESLint (type-aware rules) is unlikely to apply.

Lefthook runs Biome on staged files at commit. Biome's CI command runs in the matrix gate.

## Consequences

### Positive
- One tool, one config, one cache. Faster CI, less drift.
- No Prettier/ESLint conflict to manage. Format-on-save in editors is unambiguous.
- Bun-native install is fast; Biome is small.

### Negative
- Some ecosystem-specific rules (e.g., `eslint-plugin-react-hooks`) are not natively available in Biome. Fugazi itself doesn't ship React, so this is an internal-only constraint; the user-facing analyzer is unaffected. If we add UI later, this trade-off is reconsidered.
- Editor integration outside VS Code (Vim, Emacs) requires a Biome LSP server; we ship a `.vscode/extensions.json` recommendation but do not paper over the rest.

### Neutral
- Plugin authors writing TypeScript plugins for Fugazi (the gated tier) follow their own lint stack; Biome is our internal choice, not a plugin contract.

## References

- Requirements: `H2`
- Spec `§4.A`, `§4.B`
- ADR-001 (no `tsc` dependency)
