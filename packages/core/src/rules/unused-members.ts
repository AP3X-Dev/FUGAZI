/**
 * rules/unused-members.ts — Phase 3f.2 Wave 2 (T144).
 *
 * Two rules share one walker:
 *
 *   - `unused-enum-members`  — enum members that no consumer references.
 *   - `unused-class-members` — class members that no consumer references.
 *
 * HEURISTIC (v1, documented):
 *
 *   The current Inventory does not record per-member byte ranges nor a
 *   distinguished "member access on imported parent" usage channel. We use
 *   a conservative project-wide name match:
 *
 *     A member `M` of an exported declaration `D` (kind `enum` or `class`)
 *     in file `F` is considered USED if ANY file in the project's module
 *     graph reaches the following:
 *
 *       1. The file imports F (graph edge with `to === F.id`), AND
 *       2. The file's inventory contains a Usage with name `M` (kind
 *          `identifier` or `member`), OR a Usage with name `D.M`.
 *
 *     The parent-file's own usages also count as "used" — within-file
 *     references prove the member is wired in.
 *
 *   Skipped:
 *
 *     - Non-exported parent declarations (out of scope — internal members
 *       are unrelated to public-surface dead code).
 *     - Empty `members` arrays (the visitor populates this only for `class`
 *       and `enum` kinds; other kinds are silently ignored).
 *     - Inheritance: the current Inventory has no superclass / `extends`
 *       information. A subclass that overrides a base-class member would
 *       NOT register as a usage — DEFERRED to a later visitor enrichment.
 *
 *   Range emitted: the parent declaration's range. The visitor does not
 *   record per-member ranges; we surface the parent so reporters can guide
 *   the user to the enclosing block. v1 acceptable.
 *
 * Memoization: the registry calls both factories on the same RuleContext;
 * the WeakMap keyed on ctx caches the SEVERITY-FREE candidate list so
 * walking the inventory only happens once per run. Each rule then emits its
 * slice with its own configured severity.
 */

import type { Graph } from '@fugazi/graph';
import type {
  DiscriminatedIssue,
  Range,
  Severity,
  UnusedClassMembersIssue,
  UnusedEnumMembersIssue,
} from '@fugazi/types';
import type { RuleContext, RuleHandler } from './types.js';

const ENUM_KIND = 'unused-enum-members' as const;
const CLASS_KIND = 'unused-class-members' as const;

/**
 * Severity-free finding shape — the cache stores these and each rule wraps
 * its slice in the final discriminated-issue shape with the configured
 * severity at emit time.
 */
interface MemberCandidate {
  readonly parentKind: 'enum' | 'class';
  readonly file: string;
  readonly range: Range;
  readonly parentName: string;
  readonly memberName: string;
}

const cache = new WeakMap<RuleContext, readonly MemberCandidate[]>();

function collectCandidates(ctx: RuleContext): readonly MemberCandidate[] {
  const hit = cache.get(ctx);
  if (hit !== undefined) return hit;

  // Per-source outgoing target index — answers "does file X import file Y?"
  // in O(1) per pair.
  const outgoing = new Map<number, Set<number>>();
  for (const edge of ctx.graph.edges) {
    if (!edge.resolvable) continue;
    let bucket = outgoing.get(edge.from as unknown as number);
    if (bucket === undefined) {
      bucket = new Set<number>();
      outgoing.set(edge.from as unknown as number, bucket);
    }
    bucket.add(edge.to as unknown as number);
  }

  const candidates: MemberCandidate[] = [];
  for (const node of ctx.graph.files.values()) {
    for (const decl of node.inventory.declarations) {
      if (decl.kind !== 'enum' && decl.kind !== 'class') continue;
      if (!decl.exported) continue;
      if (decl.members.length === 0) continue;

      for (const member of decl.members) {
        if (isMemberUsed(member, decl.name, node.id as unknown as number, ctx.graph, outgoing)) {
          continue;
        }
        candidates.push({
          parentKind: decl.kind,
          file: node.path,
          range: decl.range,
          parentName: decl.name,
          memberName: member,
        });
      }
    }
  }

  candidates.sort((a, b) => {
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    if (a.parentName < b.parentName) return -1;
    if (a.parentName > b.parentName) return 1;
    return a.memberName < b.memberName ? -1 : a.memberName > b.memberName ? 1 : 0;
  });

  const frozen = Object.freeze(candidates);
  cache.set(ctx, frozen);
  return frozen;
}

function isMemberUsed(
  memberName: string,
  parentName: string,
  parentFileId: number,
  graph: Graph,
  outgoing: ReadonlyMap<number, ReadonlySet<number>>,
): boolean {
  const qualified = `${parentName}.${memberName}`;
  for (const node of graph.files.values()) {
    const fromId = node.id as unknown as number;
    if (fromId !== parentFileId) {
      const targets = outgoing.get(fromId);
      if (targets === undefined) continue;
      if (!targets.has(parentFileId)) continue;
    }
    for (const usage of node.inventory.usages) {
      if (usage.kind !== 'identifier' && usage.kind !== 'member') continue;
      if (usage.name === memberName || usage.name === qualified) return true;
    }
  }
  return false;
}

export function createUnusedEnumMembersRule(severity: Severity): RuleHandler {
  return (ctx) => {
    const out: UnusedEnumMembersIssue[] = [];
    for (const c of collectCandidates(ctx)) {
      if (c.parentKind !== 'enum') continue;
      out.push(
        Object.freeze({
          kind: ENUM_KIND,
          severity,
          file: c.file,
          range: c.range,
          enumName: c.parentName,
          memberName: c.memberName,
          message: `unused-enum-members: ${c.parentName}.${c.memberName} in ${c.file} has no consumers`,
        }) satisfies UnusedEnumMembersIssue,
      );
    }
    return out as readonly DiscriminatedIssue[];
  };
}

export function createUnusedClassMembersRule(severity: Severity): RuleHandler {
  return (ctx) => {
    const out: UnusedClassMembersIssue[] = [];
    for (const c of collectCandidates(ctx)) {
      if (c.parentKind !== 'class') continue;
      out.push(
        Object.freeze({
          kind: CLASS_KIND,
          severity,
          file: c.file,
          range: c.range,
          className: c.parentName,
          memberName: c.memberName,
          message: `unused-class-members: ${c.parentName}.${c.memberName} in ${c.file} has no consumers`,
        }) satisfies UnusedClassMembersIssue,
      );
    }
    return out as readonly DiscriminatedIssue[];
  };
}
