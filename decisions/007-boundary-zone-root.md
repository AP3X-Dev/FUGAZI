# ADR 007: Boundary zones are non-transitive; re-exports count as imports

## Status

Accepted

Date: 2026-04-30

Background / prior art: this ADR captures Fugazi's boundary-zone-root semantics. The rule-engine wiring is implemented in TypeScript.

## Context

The boundary analysis enforces architectural rules — "files in `app/features/auth/**` may not import from `app/features/billing/**`". Two design questions need an answer once and only once:

1. **Are zone rules transitive?** If `auth` is allowed to import from `shared`, and `shared` re-exports something from `billing`, has `auth` effectively reached `billing`? A transitive interpretation is mathematically clean but practically catastrophic: `shared/index.ts` re-exporting half the codebase makes every rule meaningless.
2. **Do re-exports count as imports?** When `auth/index.ts` writes `export { foo } from '../billing/foo'`, has `auth` imported from `billing`? If we say no, every violation can be laundered through a re-export.

## Decision

**Zones are non-transitive.** A rule "auth may not import from billing" applies only to direct edges out of files matching the `auth` pattern. The graph is consulted at depth 1 from each source file in a zone; we do not walk past the immediate target.

**Re-exports count as imports for boundary purposes.** Specifically, `export ... from 'X'` in a file located inside zone A produces an outgoing edge from A to whatever zone X resolves into, and that edge is checked against the rule the same way a value `import` would be.

Combined, the two rules say: a violation is a *direct* edge (import or re-export) from one zone to another that the rule does not permit. Indirection through `shared` does not save you, but neither does it falsely implicate you in violations you didn't make.

Zones are rooted at directories — each rule's `pattern` is a glob that matches files relative to the project root, and the zone "contains" a file if the glob matches its absolute path. Patterns may be flat (`features/auth/**`) or nested (`packages/*/features/auth/**`); the matching is purely lexical against the canonical path.

A zone that matches zero files emits a `FugaziAnalysisError` warning with code `BOUNDARY_RULE_NEVER_FIRES`. This catches typos in glob patterns that would otherwise produce silent passes.

## Consequences

### Positive
- Rules say what they appear to say. "auth may not import from billing" produces a violation only when an `auth` file directly references a `billing` file.
- Re-exports cannot be used as a backdoor to launder violations.
- Glob typos surface as warnings instead of "all my rules pass somehow."

### Negative
- Heavy use of barrels means `shared/index.ts` is the only file routinely allowed to import from many zones. That file therefore needs a permissive entry in any boundary configuration. This is an architectural reality, not a tool limitation; the alternative (transitive checking) is worse.
- Plugin authors writing custom architecture rules must understand the non-transitive model. Documented in `docs/plugin-authoring.md`.

### Neutral
- Power-user requests for "transitive mode" recur. We resist; the trade-offs above are why we settled here. Future changes require a follow-up ADR.

## References

- Requirements: FR-A4
- Spec `§9.4`
- ADR-005 (re-export resolution; boundary check happens after re-export resolution but reads only direct edges)
