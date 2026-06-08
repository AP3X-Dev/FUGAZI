# Conventions

Behavioral conventions for the Fugazi analyzer. Contributor workflow — branching,
commits, ADRs, testing, and code style — lives in
[`CONTRIBUTING.md`](CONTRIBUTING.md); this document covers how the tool itself
behaves and the rules it holds to.

## Configuration resolution

Fugazi reads configuration in priority order:

1. `.fugazirc.json`
2. `fugazi.config.ts`
3. `fugazi.toml`

The first file found wins — configs are not merged across formats.

## Rule severity

Every rule resolves to one of three severities:

| Severity | Effect                                                        |
| -------- | ------------------------------------------------------------- |
| `error`  | Reported and fails CI (non-zero exit). The default.           |
| `warn`   | Reported, but the exit code stays `0`.                        |
| `off`    | Skipped entirely.                                             |

## Inline suppression

Suppress findings with line- or file-scoped comments:

```ts
// fugazi-ignore-next-line [issue-type]
// fugazi-ignore-file [issue-type]
```

`[issue-type]` is optional; omitting it suppresses every issue type for that
scope. Prefer the narrowest scope that resolves the finding.

## Environment variables

| Variable        | Purpose                                  |
| --------------- | ---------------------------------------- |
| `FUGAZI_FORMAT` | Output format (e.g. `json`, `pretty`).   |
| `FUGAZI_QUIET`  | Suppress non-essential output.           |
| `FUGAZI_BIN`    | Override the resolved binary path.       |

## Determinism

Output is deterministic: the same input produces the same output, byte for byte.
File IDs are path-sorted and iteration over maps and sets follows insertion
order. Changes that introduce nondeterminism — unordered iteration, timestamps
in output, or randomness in hot paths — are not accepted.
