import type { Action } from './action.js';
import type { Range } from './position.js';
import type { RuleId } from './rule-id.js';
import type { Severity } from './severity.js';

/**
 * Issue — a single finding emitted by a Fugazi analysis pass.
 *
 * The `kind` field is the discriminant identifying which rule produced the
 * finding. T031 in a later wave refines this into a per-kind discriminated
 * union (each variant carrying its rule-specific evidence shape); this T021
 * umbrella shape is the shared field set that every variant carries.
 *
 *   - kind         — RuleId discriminant, one of the 19 named rules.
 *   - severity     — Severity at which this issue should be reported.
 *   - file         — absolute, canonicalized path to the file the issue is in.
 *   - range        — optional Range; some rules are file-level only and have
 *                    no in-file location (e.g. unused-files, circular-deps
 *                    summarized at file granularity). Per
 *                    `exactOptionalPropertyTypes`, omitting `range` is NOT
 *                    equivalent to setting it to `undefined`.
 *   - message      — human-readable description; verbatim per PRP E5 and
 *                    IMP-DX-08 (consumers grep `error.name` / `message`).
 *   - suggestions  — optional readonly array of safe, machine-applicable
 *                    Actions that would resolve this issue.
 */
export interface Issue {
  readonly kind: RuleId;
  readonly severity: Severity;
  readonly file: string;
  readonly range?: Range;
  readonly message: string;
  readonly suggestions?: readonly Action[];
}
