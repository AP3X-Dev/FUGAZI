/**
 * types.ts — Phase 4a T305 — internal types for the Python visitor pass.
 *
 * Public types (`Inventory`, `Declaration`, `Import`, `Usage`) come from
 * `../visitor/types.js` — the Python visitor emits the SAME shape as the TS
 * visitor (cross-language Inventory per Phase 4a T302). The `lang: 'py'`
 * discriminator on the returned Inventory is the only structural distinction.
 *
 * The internal types below carry mutable accumulators owned by the
 * orchestrator (`./index.ts`). Each handler appends in declaration order;
 * sorting + freezing happens once at the orchestrator's tail. Mirrors the
 * shape in `../visitor/index.ts`.
 */

import type { ASTNodePy } from '../ast/kinds-py.js';
import type { Declaration, Import, Usage } from '../visitor/types.js';

/**
 * Per-walk context handed to every handler. `bindings` is the running set of
 * names introduced in the current scope chain — used by `usages.ts` to skip
 * identifiers that resolve to a binding (function parameter, loop variable,
 * comprehension target, with-as alias, except-as alias). `bindings` lives at
 * the orchestrator level: handlers consult it before emitting, and the walker
 * adds/removes scope-bound names as it enters/leaves containers.
 */
export interface PyVisitorContext {
  readonly declarations: Declaration[];
  readonly imports: Import[];
  readonly usages: Usage[];
  /**
   * Names bound at the current source point. Entries are added when a
   * function / lambda / comprehension scope is entered (parameters, loop
   * variables, walrus targets) and removed on leave. The Set is mutated
   * IN-PLACE — usage handlers read it synchronously inside the walker
   * callback, before the walker advances to the next node.
   *
   * Note: this Set is INTERNAL-ONLY (visitor scratch state). Per IMP-DEBT-08
   * the public `Inventory` collections (declarations / imports / usages)
   * remain plain Arrays — no `Map`/`Set` leaks to consumers.
   */
  readonly bindings: Set<string>;
  /**
   * Stack of `ASTNodePy` ancestors. Pushed on enter, popped on leave. Used
   * by usage handlers to disambiguate Name positions that should NOT emit
   * (e.g. attribute attr-slot, decorator target — these are emitted by
   * dedicated handlers, not the bare-Name handler).
   */
  readonly stack: ASTNodePy[];
}
