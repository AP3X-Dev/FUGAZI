# ADR 012: Zod for config and plugin schema validation

## Status

Accepted

Date: 2026-04-30

## Context

Fugazi accepts user configuration in three formats (JSON, TypeScript, TOML) and loads community plugins as JSON files validated against a schema. The validation layer must:

1. Produce specific, actionable error messages for malformed config (line + column when possible, field path always).
2. Generate a JSON Schema that editor tooling (VS Code, JetBrains) can consume for autocomplete in `.fugazirc.json`.
3. Validate plugin manifests before any plugin code is loaded — a plugin with a malformed schema must never reach the plugin loader.

The PRP names two candidates: `valibot` and Zod. Both are TypeScript-first schema libraries with similar shapes; the differences are ecosystem maturity and JSON Schema interop.

## Decision

We use Zod across the entire validation surface — config schema, plugin manifest schema, and any future runtime input validation (e.g., LSP request payloads).

Specifically:

- `@fugazi/config` defines the top-level config schema as a Zod object.
- `tools/regen-schema.ts` runs `zod-to-json-schema` over the config schema and writes `schema.json` to the repo root. The committed JSON Schema is generated; CI verifies it stays in sync.
- The plugin loader in `@fugazi/core` validates each plugin's `manifest.json` against a Zod schema *before* loading any code from it.

Zod's `safeParse` pattern is used everywhere to avoid throwing across module boundaries. Errors are converted to `FugaziConfigError` (or the appropriate subclass) with `code`, `help`, and `context` fields per the cross-cutting error convention.

## Consequences

### Positive
- A single validation library across config, plugins, and any future runtime input. Contributors learn one API.
- `zod-to-json-schema` produces editor-friendly schemas without a hand-maintained JSON Schema file.
- Zod's error objects carry path information that maps cleanly to the `code` + `help` + `context` shape we surface to users.

### Negative
- Zod's bundle size is larger than valibot's. Irrelevant to us — Fugazi runs as a Node module, not in a browser; we never ship Zod over the wire.
- Zod's compilation time on TypeScript-heavy codebases is non-trivial. Mitigated because our schemas are small (config has ~40 fields total).

### Neutral
- The PRP's `IMP-SEC-06` requirement ("Zod validation pre-load" for plugins) is satisfied by definition. If we ever need to swap Zod, the same requirement applies to the replacement.

## References

- PRP `IMP-SEC-06`, FR-K2
- Spec `§11.B`
- ADR-013 (clipanion CLI parser, which composes with Zod for argument validation)
