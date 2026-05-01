/**
 * dynamic.ts — Phase 3c.4 Dispatch C-1 (T066) — dynamic-import shape inspector.
 *
 * Two pure inspectors for the visitor's dynamic-import handler:
 *
 *   - `constantPrefix(template)` — returns the leading constant prefix of a
 *     `TemplateLiteral` (the first quasi when there are 0+ expressions; `''`
 *     when the template begins with an interpolation slot).
 *
 *   - `classifyDynamicImport(call)` — given a `CallExpression` whose callee is
 *     the synthetic `Identifier { name: 'import' }`, classifies the first
 *     argument into one of three shapes:
 *
 *       { kind: 'literal',     source: '<verbatim>' }   — string literal
 *       { kind: 'template',    source: '<prefix>'   }   — template, prefix may be ''
 *       { kind: 'unresolvable' }                        — anything else
 *
 *     The visitor wraps these into `Import { kind: 'dynamic', ... }` records:
 *
 *       'literal'     → source: <verbatim>, resolvable: true
 *       'template'    → source: <prefix>,   resolvable: false
 *                          (the resolver narrows candidates by prefix)
 *       'unresolvable'→ source: '',         resolvable: false
 */

import type { CallExpression, Expression, TemplateLiteral } from '../ast/kinds.js';

/**
 * Result of `constantPrefix(template)`. `prefix` is the leading constant
 * string up to the first interpolation slot. `isLiteral` is `true` when the
 * template has zero interpolation slots — i.e. it is structurally equivalent
 * to a plain string literal of value `prefix`.
 */
export interface TemplatePrefix {
  readonly prefix: string;
  readonly isLiteral: boolean;
}

/**
 * Returns the constant prefix of a `TemplateLiteral`.
 *
 *   `\`./mod-${name}\``       → { prefix: './mod-', isLiteral: false }
 *   `\`${prefix}/x\``          → { prefix: '',        isLiteral: false }
 *   `\`./static\``             → { prefix: './static', isLiteral: true  }
 *   `\`\``                      → { prefix: '',        isLiteral: true  }
 *
 * Defensive: if `quasis` is empty (an impossible parser state per the JS
 * grammar), returns `{ prefix: '', isLiteral: false }`. Never throws.
 */
export function constantPrefix(node: TemplateLiteral): TemplatePrefix {
  const first = node.quasis[0];
  const prefix = typeof first === 'string' ? first : '';
  const isLiteral = node.expressions.length === 0;
  return { prefix, isLiteral };
}

/**
 * Three possible shapes a dynamic-import argument can take. See file-level
 * comment for how each maps to an `Import` record.
 */
export type DynamicImportShape =
  | { readonly kind: 'literal'; readonly source: string }
  | { readonly kind: 'template'; readonly source: string }
  | { readonly kind: 'unresolvable' };

/**
 * Classify a `CallExpression` whose callee is the synthetic dynamic-import
 * identifier (`Identifier { name: 'import' }`). Returns the import shape.
 *
 * Caller should ensure `node.callee.kind === 'Identifier' &&
 * node.callee.name === 'import'` before invoking — this function does NOT
 * re-check the callee shape.
 *
 * Edge cases:
 *   - No arguments              → 'unresolvable'
 *   - First arg is non-Literal,
 *     non-TemplateLiteral       → 'unresolvable' (Identifier, CallExpression,
 *                                                 binary expression, etc.)
 *   - First arg is Literal but
 *     not a string              → 'unresolvable' (numeric / boolean / null)
 *   - Template with empty prefix
 *     and 1+ expressions        → 'template' with source: ''
 *     (the resolver knows the source is unresolvable but receives the empty
 *      prefix for symmetry with the non-empty case)
 */
export function classifyDynamicImport(node: CallExpression): DynamicImportShape {
  const first: Expression | undefined = node.args[0];
  if (first === undefined) return { kind: 'unresolvable' };

  if (first.kind === 'Literal') {
    if (typeof first.value === 'string') {
      return { kind: 'literal', source: first.value };
    }
    return { kind: 'unresolvable' };
  }

  if (first.kind === 'TemplateLiteral') {
    const { prefix, isLiteral } = constantPrefix(first);
    // A template with no interpolation slots is structurally equivalent to a
    // plain string literal — surface it as 'literal' so the resolver treats
    // it as fully resolved.
    if (isLiteral) {
      return { kind: 'literal', source: prefix };
    }
    return { kind: 'template', source: prefix };
  }

  return { kind: 'unresolvable' };
}
