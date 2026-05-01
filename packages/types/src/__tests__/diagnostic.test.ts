import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type BoundaryViolationsIssue,
  type CircularDependenciesIssue,
  type CodeDuplicationIssue,
  type CognitiveComplexityIssue,
  type ColdCodeIssue,
  type ComplexityHotspotIssue,
  type DiscriminatedIssue,
  type DuplicateExportsIssue,
  type HotPathIssue,
  type IssueOf,
  type PrivateTypeLeakIssue,
  type UnlistedDependenciesIssue,
  type UnresolvedImportsIssue,
  type UnusedClassMembersIssue,
  type UnusedDepsIssue,
  type UnusedDevDepsIssue,
  type UnusedEnumMembersIssue,
  type UnusedExportsIssue,
  type UnusedFilesIssue,
  type UnusedOptionalDepsIssue,
  type UnusedTypesIssue,
  assertNever,
  match,
} from '../diagnostic.js';
import type { Range } from '../position.js';
import type { RuleId } from '../rule-id.js';

const RANGE: Range = {
  start: { line: 1, column: 0, byteOffset: 0 },
  end: { line: 1, column: 10, byteOffset: 10 },
};

const RANGE_2: Range = {
  start: { line: 5, column: 0, byteOffset: 100 },
  end: { line: 5, column: 20, byteOffset: 120 },
};

describe('Per-kind discriminated issue payloads', () => {
  it('UnusedFilesIssue carries path (file-level, no range)', () => {
    const issue: UnusedFilesIssue = {
      kind: 'unused-files',
      severity: 'error',
      file: '/abs/path/file.ts',
      message: 'unused file',
      path: '/abs/path/file.ts',
    };
    expect(issue.kind).toBe('unused-files');
    expect(issue.path).toBe('/abs/path/file.ts');
  });

  it('UnusedExportsIssue requires range and exportName', () => {
    const issue: UnusedExportsIssue = {
      kind: 'unused-exports',
      severity: 'warn',
      file: '/abs/a.ts',
      message: 'unused export',
      range: RANGE,
      exportName: 'foo',
    };
    expect(issue.exportName).toBe('foo');
    expect(issue.range).toEqual(RANGE);
  });

  it('UnusedTypesIssue requires range and typeName', () => {
    const issue: UnusedTypesIssue = {
      kind: 'unused-types',
      severity: 'warn',
      file: '/abs/a.ts',
      message: 'unused type',
      range: RANGE,
      typeName: 'Foo',
    };
    expect(issue.typeName).toBe('Foo');
  });

  it('UnusedDepsIssue carries dependency and manifestPath (no range)', () => {
    const issue: UnusedDepsIssue = {
      kind: 'unused-deps',
      severity: 'error',
      file: '/abs/package.json',
      message: 'unused dep',
      dependency: 'left-pad',
      manifestPath: '/abs/package.json',
    };
    expect(issue.dependency).toBe('left-pad');
  });

  it('UnusedDevDepsIssue carries dependency and manifestPath', () => {
    const issue: UnusedDevDepsIssue = {
      kind: 'unused-dev-deps',
      severity: 'warn',
      file: '/abs/package.json',
      message: 'unused dev dep',
      dependency: 'eslint-plugin-foo',
      manifestPath: '/abs/package.json',
    };
    expect(issue.kind).toBe('unused-dev-deps');
  });

  it('UnusedOptionalDepsIssue carries dependency and manifestPath', () => {
    const issue: UnusedOptionalDepsIssue = {
      kind: 'unused-optional-deps',
      severity: 'warn',
      file: '/abs/package.json',
      message: 'unused optional dep',
      dependency: 'fsevents',
      manifestPath: '/abs/package.json',
    };
    expect(issue.kind).toBe('unused-optional-deps');
  });

  it('UnusedEnumMembersIssue carries range, enumName, memberName', () => {
    const issue: UnusedEnumMembersIssue = {
      kind: 'unused-enum-members',
      severity: 'warn',
      file: '/abs/a.ts',
      message: 'unused enum member',
      range: RANGE,
      enumName: 'Color',
      memberName: 'Magenta',
    };
    expect(issue.enumName).toBe('Color');
    expect(issue.memberName).toBe('Magenta');
  });

  it('UnusedClassMembersIssue carries range, className, memberName', () => {
    const issue: UnusedClassMembersIssue = {
      kind: 'unused-class-members',
      severity: 'warn',
      file: '/abs/a.ts',
      message: 'unused class member',
      range: RANGE,
      className: 'Foo',
      memberName: 'bar',
    };
    expect(issue.className).toBe('Foo');
  });

  it('CircularDependenciesIssue carries cycle path list (no range)', () => {
    const issue: CircularDependenciesIssue = {
      kind: 'circular-dependencies',
      severity: 'error',
      file: '/abs/a.ts',
      message: 'circular',
      cycle: ['/abs/a.ts', '/abs/b.ts', '/abs/a.ts'],
    };
    expect(issue.cycle.length).toBe(3);
  });

  it('BoundaryViolationsIssue carries from/to/zones', () => {
    const issue: BoundaryViolationsIssue = {
      kind: 'boundary-violations',
      severity: 'error',
      file: '/abs/a.ts',
      message: 'boundary',
      range: RANGE,
      from: '/abs/a.ts',
      to: '/abs/b.ts',
      fromZone: 'app',
      toZone: 'infra',
    };
    expect(issue.fromZone).toBe('app');
    expect(issue.toZone).toBe('infra');
  });

  it('UnresolvedImportsIssue carries range and specifier', () => {
    const issue: UnresolvedImportsIssue = {
      kind: 'unresolved-imports',
      severity: 'error',
      file: '/abs/a.ts',
      message: 'unresolved',
      range: RANGE,
      specifier: 'missing-module',
    };
    expect(issue.specifier).toBe('missing-module');
  });

  it('UnlistedDependenciesIssue carries range and specifier', () => {
    const issue: UnlistedDependenciesIssue = {
      kind: 'unlisted-dependencies',
      severity: 'error',
      file: '/abs/a.ts',
      message: 'unlisted',
      range: RANGE,
      specifier: 'underscore',
    };
    expect(issue.specifier).toBe('underscore');
  });

  it('DuplicateExportsIssue carries occurrences and exportName', () => {
    const issue: DuplicateExportsIssue = {
      kind: 'duplicate-exports',
      severity: 'error',
      file: '/abs/a.ts',
      message: 'duplicate export',
      occurrences: [
        { file: '/abs/a.ts', range: RANGE },
        { file: '/abs/b.ts', range: RANGE_2 },
      ],
      exportName: 'foo',
    };
    expect(issue.occurrences.length).toBe(2);
    expect(issue.exportName).toBe('foo');
  });

  it('PrivateTypeLeakIssue carries leakedType and publicSymbol', () => {
    const issue: PrivateTypeLeakIssue = {
      kind: 'private-type-leak',
      severity: 'warn',
      file: '/abs/a.ts',
      message: 'private type leaks',
      range: RANGE,
      leakedType: 'Internal',
      publicSymbol: 'publicFn',
    };
    expect(issue.leakedType).toBe('Internal');
  });

  it('ComplexityHotspotIssue carries score and metric', () => {
    const issue: ComplexityHotspotIssue = {
      kind: 'complexity-hotspot',
      severity: 'warn',
      file: '/abs/a.ts',
      message: 'hotspot',
      range: RANGE,
      score: 42,
      metric: 'cyclomatic',
    };
    expect(issue.metric).toBe('cyclomatic');
    expect(issue.score).toBe(42);
  });

  it('CognitiveComplexityIssue carries score', () => {
    const issue: CognitiveComplexityIssue = {
      kind: 'cognitive-complexity',
      severity: 'warn',
      file: '/abs/a.ts',
      message: 'cognitive',
      range: RANGE,
      score: 30,
    };
    expect(issue.score).toBe(30);
  });

  it('CodeDuplicationIssue carries occurrences and cloneType', () => {
    const issue: CodeDuplicationIssue = {
      kind: 'code-duplication',
      severity: 'warn',
      file: '/abs/a.ts',
      message: 'duplication',
      occurrences: [
        { file: '/abs/a.ts', range: RANGE },
        { file: '/abs/b.ts', range: RANGE_2 },
      ],
      cloneType: 2,
    };
    expect(issue.cloneType).toBe(2);
  });

  it('ColdCodeIssue carries range and executionCount: 0', () => {
    const issue: ColdCodeIssue = {
      kind: 'cold-code',
      severity: 'warn',
      file: '/abs/a.ts',
      message: 'cold code',
      range: RANGE,
      executionCount: 0,
    };
    expect(issue.executionCount).toBe(0);
    // Cold code is by definition zero executions. The literal-0 type should
    // reject any positive count at compile time.
    // @ts-expect-error — executionCount must be the literal 0 for cold-code
    const _bad: ColdCodeIssue = {
      kind: 'cold-code',
      severity: 'warn',
      file: '/abs/a.ts',
      message: 'cold',
      range: RANGE,
      executionCount: 7,
    };
    void _bad;
  });

  it('HotPathIssue carries range and a positive executionCount', () => {
    const issue: HotPathIssue = {
      kind: 'hot-path',
      severity: 'warn',
      file: '/abs/a.ts',
      message: 'hot path',
      range: RANGE,
      executionCount: 1500,
    };
    expect(issue.executionCount).toBe(1500);
  });
});

describe('IssueOf<K> type-level lookup', () => {
  it('IssueOf<"unused-files"> resolves to UnusedFilesIssue', () => {
    expectTypeOf<IssueOf<'unused-files'>>().toEqualTypeOf<UnusedFilesIssue>();
  });

  it('IssueOf<"unused-exports"> resolves to UnusedExportsIssue', () => {
    expectTypeOf<IssueOf<'unused-exports'>>().toEqualTypeOf<UnusedExportsIssue>();
  });

  it('IssueOf<"hot-path"> resolves to HotPathIssue', () => {
    expectTypeOf<IssueOf<'hot-path'>>().toEqualTypeOf<HotPathIssue>();
  });

  it('IssueOf<"cold-code"> resolves to ColdCodeIssue', () => {
    expectTypeOf<IssueOf<'cold-code'>>().toEqualTypeOf<ColdCodeIssue>();
  });

  it('every RuleId has a corresponding IssueOf entry', () => {
    // Compile-time check: assignment from IssueOf<K> to DiscriminatedIssue is
    // lossless across the entire RuleId union.
    expectTypeOf<IssueOf<RuleId>>().toMatchTypeOf<DiscriminatedIssue>();
  });
});

describe('match() — exhaustive consumption', () => {
  const handlers = {
    'unused-files': (i: UnusedFilesIssue) => `unused-files:${i.path}`,
    'unused-exports': (i: UnusedExportsIssue) => `unused-exports:${i.exportName}`,
    'unused-types': (i: UnusedTypesIssue) => `unused-types:${i.typeName}`,
    'unused-deps': (i: UnusedDepsIssue) => `unused-deps:${i.dependency}`,
    'unused-dev-deps': (i: UnusedDevDepsIssue) => `unused-dev-deps:${i.dependency}`,
    'unused-optional-deps': (i: UnusedOptionalDepsIssue) => `unused-optional-deps:${i.dependency}`,
    'unused-enum-members': (i: UnusedEnumMembersIssue) =>
      `unused-enum-members:${i.enumName}.${i.memberName}`,
    'unused-class-members': (i: UnusedClassMembersIssue) =>
      `unused-class-members:${i.className}.${i.memberName}`,
    'circular-dependencies': (i: CircularDependenciesIssue) =>
      `circular-dependencies:${i.cycle.join('->')}`,
    'boundary-violations': (i: BoundaryViolationsIssue) =>
      `boundary-violations:${i.fromZone}->${i.toZone}`,
    'unresolved-imports': (i: UnresolvedImportsIssue) => `unresolved-imports:${i.specifier}`,
    'unlisted-dependencies': (i: UnlistedDependenciesIssue) =>
      `unlisted-dependencies:${i.specifier}`,
    'duplicate-exports': (i: DuplicateExportsIssue) =>
      `duplicate-exports:${i.exportName}:${i.occurrences.length}`,
    'private-type-leak': (i: PrivateTypeLeakIssue) => `private-type-leak:${i.leakedType}`,
    'complexity-hotspot': (i: ComplexityHotspotIssue) =>
      `complexity-hotspot:${i.metric}:${i.score}`,
    'cognitive-complexity': (i: CognitiveComplexityIssue) => `cognitive-complexity:${i.score}`,
    'code-duplication': (i: CodeDuplicationIssue) => `code-duplication:${i.cloneType}`,
    'cold-code': (i: ColdCodeIssue) => `cold-code:${i.executionCount}`,
    'hot-path': (i: HotPathIssue) => `hot-path:${i.executionCount}`,
  } as const;

  it('dispatches each kind to the corresponding handler', () => {
    const issue: UnusedExportsIssue = {
      kind: 'unused-exports',
      severity: 'warn',
      file: '/abs/a.ts',
      message: 'unused export',
      range: RANGE,
      exportName: 'foo',
    };
    expect(match(issue, handlers)).toBe('unused-exports:foo');
  });

  it('dispatches unused-files via path field', () => {
    const issue: UnusedFilesIssue = {
      kind: 'unused-files',
      severity: 'error',
      file: '/abs/a.ts',
      message: 'unused',
      path: '/abs/a.ts',
    };
    expect(match(issue, handlers)).toBe('unused-files:/abs/a.ts');
  });

  it('dispatches cold-code with executionCount 0', () => {
    const issue: ColdCodeIssue = {
      kind: 'cold-code',
      severity: 'warn',
      file: '/abs/a.ts',
      message: 'cold',
      range: RANGE,
      executionCount: 0,
    };
    expect(match(issue, handlers)).toBe('cold-code:0');
  });

  it('omitting a handler is a compile error (exhaustiveness)', () => {
    // Compile-time exhaustiveness check: a handlers object missing any
    // RuleId key must be rejected by match()'s mapped-type signature. We
    // verify this with `@ts-expect-error` on the call site below. The call
    // is wrapped in an unreachable block so it never executes at runtime —
    // we are asserting on the type system, not on runtime behavior.
    const partialHandlers = {
      'unused-files': (i: UnusedFilesIssue) => i.path,
      'unused-exports': (i: UnusedExportsIssue) => i.exportName,
      'unused-types': (i: UnusedTypesIssue) => i.typeName,
      'unused-deps': (i: UnusedDepsIssue) => i.dependency,
      'unused-dev-deps': (i: UnusedDevDepsIssue) => i.dependency,
      'unused-optional-deps': (i: UnusedOptionalDepsIssue) => i.dependency,
      'unused-enum-members': (i: UnusedEnumMembersIssue) => i.memberName,
      'unused-class-members': (i: UnusedClassMembersIssue) => i.memberName,
      'circular-dependencies': (i: CircularDependenciesIssue) => i.cycle.join(''),
      'boundary-violations': (i: BoundaryViolationsIssue) => i.fromZone,
      'unresolved-imports': (i: UnresolvedImportsIssue) => i.specifier,
      'unlisted-dependencies': (i: UnlistedDependenciesIssue) => i.specifier,
      'duplicate-exports': (i: DuplicateExportsIssue) => i.exportName,
      'private-type-leak': (i: PrivateTypeLeakIssue) => i.leakedType,
      'complexity-hotspot': (i: ComplexityHotspotIssue) => String(i.score),
      'cognitive-complexity': (i: CognitiveComplexityIssue) => String(i.score),
      'code-duplication': (i: CodeDuplicationIssue) => String(i.cloneType),
      'cold-code': (i: ColdCodeIssue) => String(i.executionCount),
      // 'hot-path' deliberately omitted — match() must not accept this object.
    };
    const issue: HotPathIssue = {
      kind: 'hot-path',
      severity: 'warn',
      file: '/abs/a.ts',
      message: 'hot',
      range: RANGE,
      executionCount: 100,
    };
    const neverRun = false as boolean;
    if (neverRun) {
      // @ts-expect-error — handlers map is missing the 'hot-path' key
      match(issue, partialHandlers);
    }
    // Assertion is purely type-level; arrival at this line means the
    // suite compiled with @ts-expect-error active (i.e. the missing
    // handler IS a compile error, as required).
    expect(neverRun).toBe(false);
  });
});

describe('assertNever', () => {
  it('throws when called', () => {
    // Cast through unknown to satisfy `never` parameter at compile time while
    // exercising the runtime guard. This is the canonical pattern.
    expect(() => assertNever('unexpected' as unknown as never)).toThrow(/Unexpected value/);
  });

  it('includes the offending value in the error message', () => {
    const offender = { surprise: true };
    expect(() => assertNever(offender as unknown as never)).toThrow(/surprise/);
  });
});

describe('Sentinel-string hygiene', () => {
  it('diagnostic.ts exports no INSTANCE_EXPORT sentinel', async () => {
    const mod = (await import('../diagnostic.js')) as Record<string, unknown>;
    for (const key of Object.keys(mod)) {
      expect(key).not.toMatch(/INSTANCE_EXPORT/);
      expect(key).not.toMatch(/SENTINEL/i);
    }
  });
});
