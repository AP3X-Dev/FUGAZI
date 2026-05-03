/**
 * rules/private-type-leak.ts — Phase 3f.2 Wave 2 (T150).
 *
 * A "private type leak" is a type-level reference to a non-exported type from
 * the signature of a publicly-exported symbol. Once such a reference exists,
 * the consumer can observe and depend on the private type even though the
 * project intends it to be internal — defeating the encapsulation.
 *
 * HEURISTIC (v1, documented):
 *
 *   Full type-signature analysis requires AST traversal at parse time
 *   (function-parameter types, return-type annotations, generic constraints,
 *   conditional types, intersection types referencing private types via
 *   type-level computation, …). The current Inventory exposes only
 *   declarations / imports / usages with byte ranges; we do NOT have a
 *   distinguished "type-position usage" channel.
 *
 *   This v1 implementation falls back to a conservative byte-range overlap
 *   check:
 *
 *     1. Build the set of file-private type names (`kind === 'type' &&
 *        exported === false`).
 *     2. For every exported public symbol (`exported === true && kind !==
 *        'type'`) with a non-empty range, look for an `identifier` or
 *        `member` Usage whose `name` is in the private-types set AND whose
 *        byte range falls inside the public symbol's byte range.
 *     3. Each such overlap is a candidate leak — emit one finding per
 *        (publicSymbol, leakedType, usageRange) triple.
 *
 *   Known false-negatives:
 *
 *     - Generic constraints (`<T extends PrivateType>`) where the
 *       constraint usage is not flagged as `identifier`/`member`.
 *     - Type-level computation (`type Pub = Helper<PrivateType>`) where the
 *       reference does not appear as a runtime usage in Inventory.
 *     - Conditional / intersection / mapped types referencing private
 *       members.
 *
 *   Known false-positives:
 *
 *     - A public function whose body legitimately uses a private type at
 *       runtime (not in its signature). The byte-range overlap captures
 *       these conservatively. v1 accepts the noise.
 *
 *   A subsequent visitor enrichment phase will add a `kind: 'type-ref'`
 *   Usage channel that lets us narrow this to true signature leaks.
 */

import type { DiscriminatedIssue, PrivateTypeLeakIssue, Range, Severity } from '@fugazi/types';
import type { RuleHandler } from './types.js';

const RULE_KIND = 'private-type-leak' as const;

export function createPrivateTypeLeakRule(severity: Severity): RuleHandler {
  return (ctx) => {
    const out: PrivateTypeLeakIssue[] = [];

    for (const node of ctx.graph.files.values()) {
      // Phase 4c T338: Python doesn't have an enforced public/private type
      // distinction (leading underscore is convention, not language-level).
      // Skip `.py` files entirely for v1 — the rule emits zero issues on
      // Python sources, in line with the v1.x carry decision in the plan.
      if (node.path.endsWith('.py') || node.inventory.lang === 'py') continue;

      const privateTypes = new Set<string>();
      const publicSymbols: { readonly name: string; readonly range: Range }[] = [];

      for (const decl of node.inventory.declarations) {
        if (decl.kind === 'type' && !decl.exported) {
          privateTypes.add(decl.name);
        } else if (decl.exported && decl.kind !== 'type') {
          publicSymbols.push({ name: decl.name, range: decl.range });
        }
      }

      if (privateTypes.size === 0 || publicSymbols.length === 0) continue;

      for (const usage of node.inventory.usages) {
        if (usage.kind !== 'identifier' && usage.kind !== 'member') continue;
        if (!privateTypes.has(usage.name)) continue;

        const enclosing = findEnclosing(usage.range, publicSymbols);
        if (enclosing === undefined) continue;

        out.push(
          Object.freeze({
            kind: RULE_KIND,
            severity,
            file: node.path,
            range: usage.range,
            leakedType: usage.name,
            publicSymbol: enclosing.name,
            message: `private-type-leak: ${usage.name} leaks into public signature of ${enclosing.name} in ${node.path}`,
          }) satisfies PrivateTypeLeakIssue,
        );
      }
    }

    out.sort((a, b) => {
      if (a.file < b.file) return -1;
      if (a.file > b.file) return 1;
      return a.range.start.byteOffset - b.range.start.byteOffset;
    });

    return out as readonly DiscriminatedIssue[];
  };
}

/** Return the public symbol whose byte range fully contains `usageRange`. */
function findEnclosing(
  usageRange: Range,
  publicSymbols: readonly { readonly name: string; readonly range: Range }[],
): { readonly name: string; readonly range: Range } | undefined {
  for (const sym of publicSymbols) {
    const symStart = sym.range.start.byteOffset;
    const symEnd = sym.range.end.byteOffset;
    const useStart = usageRange.start.byteOffset;
    const useEnd = usageRange.end.byteOffset;
    if (useStart >= symStart && useEnd <= symEnd) {
      return sym;
    }
  }
  return undefined;
}
