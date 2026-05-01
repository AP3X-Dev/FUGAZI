# ADR 013: clipanion (class-based commands) for the CLI parser

## Status

Accepted

Date: 2026-04-30

## Context

The `fugazi` binary exposes 17 subcommands at v1.0 (`check`, `dead-code`, `dupes`, `health`, `boundaries`, `coverage setup`, `coverage status`, `lsp`, `mcp`, `init`, `fix`, `watch`, `explain`, `plugin install`, etc.). We need a CLI parser that handles:

1. Nested subcommands without manual sub-parser plumbing (`fugazi coverage setup` is a real command).
2. Type-safe option declaration in TypeScript with the validation co-located with the command.
3. Auto-generated `--help` output.
4. Native support for preset/alias expansion (`--preset ci` becomes a fixed set of flags).

PRP candidates were `commander` and `clipanion`. Both are competent. The differentiator is ergonomics for nested subcommands and the class-based command model.

## Decision

We use `clipanion`. Each subcommand is a class extending `Command` with decorators (or static schema fields, depending on Clipanion's TS support level at the time of implementation) declaring options. The class's `execute` method runs the command. This keeps each subcommand self-contained: contributors add a file to `packages/cli/src/commands/`, register it in the entry point, and the new subcommand is wired up.

Clipanion's nested-command syntax handles `fugazi coverage setup` naturally — the second word is registered as a path segment, not a positional argument. This is the only library among the candidates that gets this right without manual sub-parser wiring.

Argument validation that goes beyond Clipanion's built-ins (e.g., "this path must be an existing directory") composes with Zod (ADR-012): the command parses raw arguments via Clipanion, then runs them through a Zod schema for richer validation.

## Consequences

### Positive
- Clean class-per-command structure scales to 17+ subcommands without a switch statement explosion.
- Type-safe options at the command level catch mistakes at compile time.
- `--help` generation is automatic and consistent across subcommands.

### Negative
- Clipanion's API is less familiar than commander's; new contributors will spend time on the docs. Mitigated by the small surface area each command actually touches.
- Clipanion's TypeScript decorator support depends on the project's `tsconfig` settings; we pin `"experimentalDecorators"` cleanly off and use static schema fields instead, avoiding the legacy decorator API entirely.

### Neutral
- The presence of clipanion is invisible to end users. They only see `fugazi --help`.

## References

- PRP FR-C1
- Spec `§11.A`
- ADR-012 (Zod validation, composes with clipanion option parsing)
