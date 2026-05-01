import type { Issue } from './issue.js';
import type { Range } from './position.js';
import type { RuleId } from './rule-id.js';

/**
 * Diagnostic discriminated union — refines the umbrella `Issue` (T021) into
 * one variant per `RuleId`, each carrying its rule-specific evidence shape.
 *
 * The umbrella `Issue` declares the shared fields (`kind`, `severity`, `file`,
 * optional `range`, `message`, optional `suggestions`). The per-kind variants
 * below narrow `kind` to a single literal and add (or promote `range?` to a
 * required `range`) any extra fields the rule needs.
 *
 * Per IMP-DEBT-08 + IMP-DEBT-11, no string sentinels are used. Per FR-I1 +
 * FR-I2, every variant is `readonly`-deep so reporters cannot mutate findings
 * during emit. Phase 3j reporters translate camelCase to snake_case where the
 * output schema demands it.
 */

/**
 * `unused-files` — file-level finding; the file itself is the orphan.
 *
 * Carries the orphan path explicitly to keep reporters free of `Issue.file`
 * vs `path` ambiguity (the two are equal here but distinguished elsewhere,
 * e.g. boundary-violations where `file` is the source and `to` is the import
 * target).
 */
export type UnusedFilesIssue = Issue & {
  readonly kind: 'unused-files';
  readonly path: string;
};

/** `unused-exports` — a named export that no other module imports. */
export type UnusedExportsIssue = Issue & {
  readonly kind: 'unused-exports';
  readonly range: Range;
  readonly exportName: string;
};

/** `unused-types` — an exported type/interface that no other module imports. */
export type UnusedTypesIssue = Issue & {
  readonly kind: 'unused-types';
  readonly range: Range;
  readonly typeName: string;
};

/** `unused-deps` — a `dependencies` entry no source file imports. */
export type UnusedDepsIssue = Issue & {
  readonly kind: 'unused-deps';
  readonly dependency: string;
  readonly manifestPath: string;
};

/** `unused-dev-deps` — a `devDependencies` entry no source/test file imports. */
export type UnusedDevDepsIssue = Issue & {
  readonly kind: 'unused-dev-deps';
  readonly dependency: string;
  readonly manifestPath: string;
};

/** `unused-optional-deps` — an `optionalDependencies` entry never imported. */
export type UnusedOptionalDepsIssue = Issue & {
  readonly kind: 'unused-optional-deps';
  readonly dependency: string;
  readonly manifestPath: string;
};

/** `unused-enum-members` — an enum member no consumer references. */
export type UnusedEnumMembersIssue = Issue & {
  readonly kind: 'unused-enum-members';
  readonly range: Range;
  readonly enumName: string;
  readonly memberName: string;
};

/** `unused-class-members` — a class member no consumer references. */
export type UnusedClassMembersIssue = Issue & {
  readonly kind: 'unused-class-members';
  readonly range: Range;
  readonly className: string;
  readonly memberName: string;
};

/**
 * `circular-dependencies` — a closed import cycle.
 *
 * `cycle` is the path-list walk of the cycle; the first and last entries are
 * the same file (so a 2-file cycle is `[a, b, a]`). File-level — no `range`.
 */
export type CircularDependenciesIssue = Issue & {
  readonly kind: 'circular-dependencies';
  readonly cycle: readonly string[];
};

/**
 * `boundary-violations` — a layered-architecture import that crosses a zone.
 *
 * `from` / `to` are absolute file paths; `fromZone` / `toZone` are the named
 * boundary zones from config (e.g. `app`, `infra`, `domain`).
 */
export type BoundaryViolationsIssue = Issue & {
  readonly kind: 'boundary-violations';
  readonly range: Range;
  readonly from: string;
  readonly to: string;
  readonly fromZone: string;
  readonly toZone: string;
};

/** `unresolved-imports` — an import whose specifier resolves to nothing. */
export type UnresolvedImportsIssue = Issue & {
  readonly kind: 'unresolved-imports';
  readonly range: Range;
  readonly specifier: string;
};

/** `unlisted-dependencies` — an import of a package not in `package.json`. */
export type UnlistedDependenciesIssue = Issue & {
  readonly kind: 'unlisted-dependencies';
  readonly range: Range;
  readonly specifier: string;
};

/**
 * `duplicate-exports` — the same named export emitted from multiple files.
 *
 * `occurrences` is the full set of locations; ordering is reporter-defined
 * (the analysis pipeline emits path-sorted to satisfy NFR-1 determinism).
 */
export type DuplicateExportsIssue = Issue & {
  readonly kind: 'duplicate-exports';
  readonly occurrences: readonly { readonly file: string; readonly range: Range }[];
  readonly exportName: string;
};

/**
 * `private-type-leak` — a non-exported type referenced from a public symbol's
 * signature, so the type effectively becomes part of the public surface.
 */
export type PrivateTypeLeakIssue = Issue & {
  readonly kind: 'private-type-leak';
  readonly range: Range;
  readonly leakedType: string;
  readonly publicSymbol: string;
};

/**
 * `complexity-hotspot` — a function exceeding a complexity threshold under
 * the named metric.
 */
export type ComplexityHotspotIssue = Issue & {
  readonly kind: 'complexity-hotspot';
  readonly range: Range;
  readonly score: number;
  readonly metric: 'cyclomatic' | 'cognitive' | 'maintainability-index';
};

/**
 * `cognitive-complexity` — a function exceeding the cognitive-complexity
 * threshold (kept as its own variant for direct routing in reporters).
 */
export type CognitiveComplexityIssue = Issue & {
  readonly kind: 'cognitive-complexity';
  readonly range: Range;
  readonly score: number;
};

/**
 * `code-duplication` — clone-detection finding.
 *
 * `cloneType` follows the standard taxonomy: 1=exact, 2=renamed, 3=near-miss,
 * 4=semantic. `occurrences` is the full set of clone instances.
 */
export type CodeDuplicationIssue = Issue & {
  readonly kind: 'code-duplication';
  readonly occurrences: readonly { readonly file: string; readonly range: Range }[];
  readonly cloneType: 1 | 2 | 3 | 4;
};

/**
 * `cold-code` — a function present in the static graph but never executed in
 * any sampled run (FR-H2). `executionCount` is the literal `0` by definition;
 * a positive count would fall under `hot-path` instead.
 */
export type ColdCodeIssue = Issue & {
  readonly kind: 'cold-code';
  readonly range: Range;
  readonly executionCount: 0;
};

/** `hot-path` — a function executed at or above the hot-path threshold (FR-H1). */
export type HotPathIssue = Issue & {
  readonly kind: 'hot-path';
  readonly range: Range;
  readonly executionCount: number;
};

/**
 * `DiscriminatedIssue` — closed union over every per-`RuleId` variant. Use
 * this in reporters and analyzers wherever exhaustive narrowing is required.
 */
export type DiscriminatedIssue =
  | UnusedFilesIssue
  | UnusedExportsIssue
  | UnusedTypesIssue
  | UnusedDepsIssue
  | UnusedDevDepsIssue
  | UnusedOptionalDepsIssue
  | UnusedEnumMembersIssue
  | UnusedClassMembersIssue
  | CircularDependenciesIssue
  | BoundaryViolationsIssue
  | UnresolvedImportsIssue
  | UnlistedDependenciesIssue
  | DuplicateExportsIssue
  | PrivateTypeLeakIssue
  | ComplexityHotspotIssue
  | CognitiveComplexityIssue
  | CodeDuplicationIssue
  | ColdCodeIssue
  | HotPathIssue;

/**
 * `IssueOf<K>` — type-level lookup from a `RuleId` to its corresponding
 * per-kind issue type. Equivalent to `Extract<DiscriminatedIssue, { kind: K }>`.
 */
export type IssueOf<K extends RuleId> = Extract<DiscriminatedIssue, { kind: K }>;

/**
 * Exhaustiveness assertion. Place at the end of a `switch` over a
 * discriminated union; if any variant is unhandled, TS will flag the call.
 *
 * Throws at runtime if it is reached, including the offending value in the
 * error message for diagnostic purposes.
 */
export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}

/**
 * Switch-style exhaustive consumer for a `DiscriminatedIssue`.
 *
 * `handlers` is an object whose keys are every `RuleId` and whose values are
 * functions accepting the corresponding `IssueOf<K>`. Omitting any key is a
 * compile error (the type-system enforces exhaustiveness via the mapped type
 * `{ [K in RuleId]: (i: IssueOf<K>) => R }`).
 */
export function match<R>(
  issue: DiscriminatedIssue,
  handlers: { readonly [K in RuleId]: (i: IssueOf<K>) => R },
): R {
  switch (issue.kind) {
    case 'unused-files':
      return handlers['unused-files'](issue);
    case 'unused-exports':
      return handlers['unused-exports'](issue);
    case 'unused-types':
      return handlers['unused-types'](issue);
    case 'unused-deps':
      return handlers['unused-deps'](issue);
    case 'unused-dev-deps':
      return handlers['unused-dev-deps'](issue);
    case 'unused-optional-deps':
      return handlers['unused-optional-deps'](issue);
    case 'unused-enum-members':
      return handlers['unused-enum-members'](issue);
    case 'unused-class-members':
      return handlers['unused-class-members'](issue);
    case 'circular-dependencies':
      return handlers['circular-dependencies'](issue);
    case 'boundary-violations':
      return handlers['boundary-violations'](issue);
    case 'unresolved-imports':
      return handlers['unresolved-imports'](issue);
    case 'unlisted-dependencies':
      return handlers['unlisted-dependencies'](issue);
    case 'duplicate-exports':
      return handlers['duplicate-exports'](issue);
    case 'private-type-leak':
      return handlers['private-type-leak'](issue);
    case 'complexity-hotspot':
      return handlers['complexity-hotspot'](issue);
    case 'cognitive-complexity':
      return handlers['cognitive-complexity'](issue);
    case 'code-duplication':
      return handlers['code-duplication'](issue);
    case 'cold-code':
      return handlers['cold-code'](issue);
    case 'hot-path':
      return handlers['hot-path'](issue);
    default:
      return assertNever(issue);
  }
}
