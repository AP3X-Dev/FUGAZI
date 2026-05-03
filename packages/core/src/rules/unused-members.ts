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

import type { Declaration } from '@fugazi/extract';
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
 * Phase 4c T333. Python "dunder" (double-underscore) lifecycle methods that
 * runtime / language semantics invoke on the user's behalf. A class member
 * matching any of these is presumed-used regardless of intra-project
 * references. Includes operator overloads + the `r`/`i` reflected/in-place
 * variants. ~50 names total — chosen for v1 coverage; the plugin layer
 * (Phase 4d) refines via per-framework `usedClassMembers` rules.
 */
const PY_DUNDER_LIFECYCLE_METHODS: ReadonlySet<string> = new Set([
  // Construction / destruction
  '__init__',
  '__init_subclass__',
  '__new__',
  '__del__',
  // Conversion / representation
  '__repr__',
  '__str__',
  '__bytes__',
  '__format__',
  '__hash__',
  '__bool__',
  // Class / attribute access
  '__class_getitem__',
  '__getattr__',
  '__setattr__',
  '__delattr__',
  '__getattribute__',
  '__dir__',
  // Container protocol
  '__call__',
  '__len__',
  '__length_hint__',
  '__iter__',
  '__next__',
  '__reversed__',
  '__contains__',
  '__getitem__',
  '__setitem__',
  '__delitem__',
  '__missing__',
  // Context-manager protocol
  '__enter__',
  '__exit__',
  '__aenter__',
  '__aexit__',
  // Async
  '__await__',
  '__aiter__',
  '__anext__',
  // Comparison
  '__eq__',
  '__ne__',
  '__lt__',
  '__le__',
  '__gt__',
  '__ge__',
  // Arithmetic + reflected + in-place
  '__add__',
  '__radd__',
  '__iadd__',
  '__sub__',
  '__rsub__',
  '__isub__',
  '__mul__',
  '__rmul__',
  '__imul__',
  '__truediv__',
  '__rtruediv__',
  '__itruediv__',
  '__floordiv__',
  '__rfloordiv__',
  '__ifloordiv__',
  '__mod__',
  '__rmod__',
  '__imod__',
  '__pow__',
  '__rpow__',
  '__ipow__',
  '__matmul__',
  '__rmatmul__',
  '__imatmul__',
  // Bitwise
  '__and__',
  '__rand__',
  '__iand__',
  '__or__',
  '__ror__',
  '__ior__',
  '__xor__',
  '__rxor__',
  '__ixor__',
  '__lshift__',
  '__rlshift__',
  '__ilshift__',
  '__rshift__',
  '__rrshift__',
  '__irshift__',
  // Unary
  '__neg__',
  '__pos__',
  '__abs__',
  '__invert__',
  // Numeric coercions
  '__int__',
  '__float__',
  '__complex__',
  '__round__',
  '__index__',
  // Pickle / copy
  '__reduce__',
  '__reduce_ex__',
  '__getstate__',
  '__setstate__',
  '__copy__',
  '__deepcopy__',
  // Descriptor protocol
  '__get__',
  '__set__',
  '__delete__',
  '__set_name__',
  // Class machinery
  '__instancecheck__',
  '__subclasscheck__',
  '__subclasshook__',
  // Frozen-set / mapping
  '__weakref__',
]);

/**
 * Phase 4c T333 + Phase 4d T346. Build the per-class set of member names
 * that should NOT be flagged as unused. Returns null for non-Python classes
 * (caller skips the lookup). Includes:
 *   - All dunder lifecycle methods that the class actually defines.
 *   - All members whose decorators overlap with the active plugins'
 *     `usedDecorators` allowlist (T346 refinement). Bare-form names like
 *     `'fixture'` match both `@fixture` and `@pytest.fixture` — the rule
 *     compares against the dotted decorator name AND its trailing segment.
 *   - When the active-plugin allowlist is EMPTY (no Python plugin loaded),
 *     fall back to the conservative T333 behaviour and exempt every
 *     decorated member regardless of decorator name. This preserves
 *     pre-Phase-4d behaviour on projects where no framework plugin
 *     contributes decorator hints — better to under-flag than over-flag.
 */
function buildPyMemberExemptions(
  decl: Declaration,
  pluginUsedDecorators: ReadonlySet<string>,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const m of decl.members) {
    if (PY_DUNDER_LIFECYCLE_METHODS.has(m)) out.add(m);
  }
  // Phase 4f T381. AnnAssign-shaped class members (annotated class
  // attributes — `class User(BaseModel): name: str`) are the canonical
  // field idiom across Pydantic, dataclasses, attrs, and SQLAlchemy
  // declarative bases. Their consumption shape (constructor kwargs, ORM
  // binding, model property access) is NOT captured by the literal
  // `.member` usage pass that drives `isMemberUsed`. Hard-coding the
  // exemption here for `lang: 'py'` is the correct v1 trade-off: a few
  // false-negatives on unannotated-class-level constants beats the
  // false-positive volume from every Pydantic / dataclass field. Plugin-
  // driven refinement (per-base-class field tracking) is a v1.x ask.
  if (decl.fieldMembers !== undefined) {
    for (const m of decl.fieldMembers) out.add(m);
  }
  // Active-plugin allowlist refinement (T346): exempt only members whose
  // decorators include at least one allowlisted name. Bare-form match: the
  // trailing segment of a dotted decorator is checked against the bare-form
  // entries in the allowlist (e.g. `'fixture'` matches `@pytest.fixture`).
  if (decl.memberDecorations !== undefined && pluginUsedDecorators.size > 0) {
    for (const md of decl.memberDecorations) {
      let exempted = false;
      for (const dotted of md.decorators) {
        if (pluginUsedDecorators.has(dotted)) {
          exempted = true;
          break;
        }
        const lastDot = dotted.lastIndexOf('.');
        if (lastDot >= 0) {
          const tail = dotted.slice(lastDot + 1);
          if (pluginUsedDecorators.has(tail)) {
            exempted = true;
            break;
          }
        }
      }
      if (exempted) out.add(md.name);
    }
    return out;
  }
  // Fallback (T333 legacy): no active-plugin decorator allowlist — exempt
  // every decorated member.
  if (decl.decoratedMembers !== undefined) {
    for (const m of decl.decoratedMembers) out.add(m);
  }
  return out;
}

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

  // Phase 4d T346. Build the union of `usedDecorators` across active
  // plugins. Empty when no plugin contributed — the per-class exemption
  // builder falls back to the T333 legacy "skip-all-decorated" behaviour.
  const pluginUsedDecorators = new Set<string>();
  if (ctx.activePlugins !== undefined) {
    for (const plugin of ctx.activePlugins) {
      for (const dec of plugin.usedDecorators) pluginUsedDecorators.add(dec);
    }
  }

  const candidates: MemberCandidate[] = [];
  for (const node of ctx.graph.files.values()) {
    const isPy = node.path.endsWith('.py') || node.inventory.lang === 'py';
    for (const decl of node.inventory.declarations) {
      if (decl.kind !== 'enum' && decl.kind !== 'class') continue;
      if (!decl.exported) continue;
      if (decl.members.length === 0) continue;

      // Phase 4c T333 + Phase 4d T346: build the per-class Python exemption
      // set. Members matching the dunder allowlist OR carrying an
      // allowlisted decorator (or any decorator when the allowlist is
      // empty, preserving T333 behaviour) are framework-presumed-used.
      const pyExempt = isPy ? buildPyMemberExemptions(decl, pluginUsedDecorators) : null;

      for (const member of decl.members) {
        if (pyExempt?.has(member)) continue;
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
