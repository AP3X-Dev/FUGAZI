/**
 * usages.ts — Phase 4a T305 — usage handlers for the Python visitor.
 *
 * Emits one `Usage` per:
 *   - bare `Name` reference at expression position (kind `'identifier'`)
 *   - `Attribute` access — emits `'member'` usage carrying the BASE name of
 *     the access chain (`obj.foo.bar` → `obj`)
 *   - `Decorator` reference — emits `'decorator'` usage carrying the
 *     dotted-name of the decorator (`@app.route` → `app.route`,
 *     `@dataclass` → `dataclass`, `@app.route("/")` → `app.route`)
 *
 * Skip rules — Names in BINDING positions are deliberately suppressed:
 *   - Function / lambda parameters (already in `ctx.bindings` by the time
 *     the walker descends into the body)
 *   - Loop variables in `for x in ...:` (added before walking body)
 *   - Comprehension targets
 *   - Walrus targets
 *   - With-as / except-as alias targets
 *   - The `target` slot of Assign / AnnAssign / AugAssign (the adapter
 *     stores these as strings, not Names — they never reach the walker)
 *
 * The orchestrator (`./index.ts`) maintains the binding scope set; this
 * file is the read side.
 */

import type { ASTNodePy, Attribute, Decorator, Name, PyExpression } from '../ast/kinds-py.js';
import type { Usage } from '../visitor/types.js';
import type { PyVisitorContext } from './types.js';

/**
 * `handleName` — emit an identifier-usage for a free `Name` reference.
 * Skips bindings (per `ctx.bindings`) and skips slots already covered by
 * dedicated handlers (Attribute.value via `handleAttribute`, Decorator
 * payload via `handleDecorator`).
 */
export function handleName(node: Name, parent: ASTNodePy | null, ctx: PyVisitorContext): void {
  if (node.id === '') return;
  if (ctx.bindings.has(node.id)) return;
  if (parent !== null) {
    // Skip names already consumed by a parent handler.
    if (parent.kind === 'Attribute') {
      // Only the base of the access chain is emitted by `handleAttribute`.
      // Inner Attribute.value descends here only when the inner is a Name —
      // and `handleAttribute` already pushed a 'member' usage for the
      // outermost chain. The single name reaches us when it IS the base.
      // We DO emit it (as 'identifier') because the outer Attribute already
      // emits a 'member' usage with name=`<base>` covering the same source
      // span — the consumers expect both kinds (the TS visitor mirrors this:
      // an `obj.foo` produces a 'member' usage AND the inner Identifier's
      // 'member' kind is emitted via classifyIdentifier's MemberExpression
      // path). For Python, our parallel is: emit `'member'` from
      // `handleAttribute` for the outermost shape, do nothing here for the
      // base Name.
      return;
    }
    if (parent.kind === 'Decorator') {
      // Decorator handler emits the usage; skip the inner bare-Name.
      return;
    }
    if (parent.kind === 'Walrus') {
      // Walrus.value is walked here; the target is a string, never a Name.
      // The Name we receive is therefore the value side — emit normally.
    }
  }
  ctx.usages.push({ kind: 'identifier', name: node.id, range: node.range });
}

/**
 * `handleAttribute` — emit a `'member'` usage for an attribute-access chain.
 * The emitted name is the BASE of the chain (`a.b.c` → `'a'`); intermediate
 * attribute slots collapse. Mirrors the TS visitor's `MemberExpression`
 * `'member'` emission.
 */
export function handleAttribute(node: Attribute, ctx: PyVisitorContext): void {
  const base = baseNameOf(node);
  if (base === '') return;
  if (ctx.bindings.has(base)) return;
  ctx.usages.push({ kind: 'member', name: base, range: node.range });
}

/**
 * `handleDecorator` — emit a `'decorator'` usage for a decorator
 * application. The emitted name is the DOTTED form of the decorator
 * expression: `@dataclass` → `'dataclass'`, `@app.route` → `'app.route'`,
 * `@app.route("/")` → `'app.route'` (the call wrapper is unwrapped).
 */
export function handleDecorator(node: Decorator, ctx: PyVisitorContext): void {
  const name = decoratorName(node.expression);
  if (name === '') return;
  ctx.usages.push({ kind: 'decorator', name, range: node.range });
}

/**
 * Walk down an Attribute chain to find the base Name (or empty when the
 * chain bottoms out in a non-Name expression — e.g. `"abc".split()` whose
 * receiver is a string literal).
 */
function baseNameOf(node: PyExpression): string {
  let cursor: PyExpression = node;
  while (cursor.kind === 'Attribute') {
    cursor = cursor.value;
  }
  if (cursor.kind === 'Name') return cursor.id;
  return '';
}

/**
 * Render the decorator expression as a dotted name. Unwraps a single Call
 * layer (decorators-with-arguments).
 */
function decoratorName(expr: PyExpression): string {
  // `@dec(...)` — unwrap the Call, keep walking the callee.
  let cursor: PyExpression = expr;
  if (cursor.kind === 'Call') cursor = cursor.func;
  if (cursor.kind === 'Name') return cursor.id;
  if (cursor.kind === 'Attribute') {
    return renderAttribute(cursor);
  }
  return '';
}

function renderAttribute(node: Attribute): string {
  const parts: string[] = [];
  let cursor: PyExpression = node;
  while (cursor.kind === 'Attribute') {
    parts.unshift(cursor.attr);
    cursor = cursor.value;
  }
  if (cursor.kind === 'Name') {
    parts.unshift(cursor.id);
    return parts.join('.');
  }
  return '';
}

/**
 * `collectParameterBindings` — walk a parameter list and surface the bound
 * names so the orchestrator can add them to `ctx.bindings` before
 * descending into the function body. Empty-string params (opaque patterns)
 * and the `/`/`*` separators are skipped.
 */
export function collectParameterBindings(
  params: readonly { readonly name: string; readonly kind: string }[],
): readonly string[] {
  const out: string[] = [];
  for (const p of params) {
    if (p.name === '' || p.name === '/' || p.name === '*') continue;
    out.push(p.name);
  }
  return out;
}

/**
 * Re-export of `Usage` for callers wanting to type the accumulator without
 * reaching into the cross-language types module directly.
 */
export type { Usage };
