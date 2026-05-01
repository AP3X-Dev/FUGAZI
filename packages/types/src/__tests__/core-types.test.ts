import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Action, Issue, Position, Range, RuleId, Severity } from '../index.js';

describe('Severity', () => {
  it('is the union "error" | "warn" | "off"', () => {
    expectTypeOf<Severity>().toEqualTypeOf<'error' | 'warn' | 'off'>();
  });

  it('rejects unknown severity strings', () => {
    expectTypeOf<Severity>().not.toEqualTypeOf<string>();
    // @ts-expect-error — 'fatal' is not a valid Severity
    const _bad: Severity = 'fatal';
    void _bad;
  });

  it('accepts each valid severity at runtime', () => {
    const values: readonly Severity[] = ['error', 'warn', 'off'];
    expect(values).toEqual(['error', 'warn', 'off']);
  });
});

describe('RuleId', () => {
  // The 19 named rules from PRP FR-E1, in source order. Committed verbatim.
  const ALL_RULES: readonly RuleId[] = [
    'unused-files',
    'unused-exports',
    'unused-types',
    'unused-deps',
    'unused-dev-deps',
    'unused-optional-deps',
    'unused-enum-members',
    'unused-class-members',
    'circular-dependencies',
    'boundary-violations',
    'unresolved-imports',
    'unlisted-dependencies',
    'duplicate-exports',
    'private-type-leak',
    'complexity-hotspot',
    'cognitive-complexity',
    'code-duplication',
    'cold-code',
    'hot-path',
  ];

  it('contains exactly 19 named rules', () => {
    expect(new Set(ALL_RULES).size).toBe(19);
  });

  it('rejects strings outside the union', () => {
    // @ts-expect-error — 'made-up-rule' is not in the union
    const _bad: RuleId = 'made-up-rule';
    void _bad;
  });

  it('accepts every literal in the union', () => {
    expectTypeOf<'unused-files'>().toMatchTypeOf<RuleId>();
    expectTypeOf<'unused-exports'>().toMatchTypeOf<RuleId>();
    expectTypeOf<'unused-types'>().toMatchTypeOf<RuleId>();
    expectTypeOf<'unused-deps'>().toMatchTypeOf<RuleId>();
    expectTypeOf<'unused-dev-deps'>().toMatchTypeOf<RuleId>();
    expectTypeOf<'unused-optional-deps'>().toMatchTypeOf<RuleId>();
    expectTypeOf<'unused-enum-members'>().toMatchTypeOf<RuleId>();
    expectTypeOf<'unused-class-members'>().toMatchTypeOf<RuleId>();
    expectTypeOf<'circular-dependencies'>().toMatchTypeOf<RuleId>();
    expectTypeOf<'boundary-violations'>().toMatchTypeOf<RuleId>();
    expectTypeOf<'unresolved-imports'>().toMatchTypeOf<RuleId>();
    expectTypeOf<'unlisted-dependencies'>().toMatchTypeOf<RuleId>();
    expectTypeOf<'duplicate-exports'>().toMatchTypeOf<RuleId>();
    expectTypeOf<'private-type-leak'>().toMatchTypeOf<RuleId>();
    expectTypeOf<'complexity-hotspot'>().toMatchTypeOf<RuleId>();
    expectTypeOf<'cognitive-complexity'>().toMatchTypeOf<RuleId>();
    expectTypeOf<'code-duplication'>().toMatchTypeOf<RuleId>();
    expectTypeOf<'cold-code'>().toMatchTypeOf<RuleId>();
    expectTypeOf<'hot-path'>().toMatchTypeOf<RuleId>();
  });

  it('is not assignable to arbitrary string', () => {
    expectTypeOf<RuleId>().not.toEqualTypeOf<string>();
  });
});

describe('Position and Range', () => {
  it('Position has readonly line, column, byteOffset', () => {
    expectTypeOf<Position>().toEqualTypeOf<{
      readonly line: number;
      readonly column: number;
      readonly byteOffset: number;
    }>();
  });

  it('Range has readonly start and end Positions', () => {
    expectTypeOf<Range>().toEqualTypeOf<{
      readonly start: Position;
      readonly end: Position;
    }>();
  });

  it('constructs a valid range at runtime', () => {
    const range: Range = {
      start: { line: 1, column: 0, byteOffset: 0 },
      end: { line: 1, column: 10, byteOffset: 10 },
    };
    expect(range.start.line).toBe(1);
    expect(range.end.column).toBe(10);
  });
});

describe('Issue', () => {
  it('has discriminant kind: RuleId plus shared readonly fields', () => {
    type IssueKind = Issue['kind'];
    expectTypeOf<IssueKind>().toEqualTypeOf<RuleId>();
    expectTypeOf<Issue['severity']>().toEqualTypeOf<Severity>();
    expectTypeOf<Issue['file']>().toEqualTypeOf<string>();
    expectTypeOf<Issue['message']>().toEqualTypeOf<string>();
  });

  it('has optional range and suggestions (exactOptionalPropertyTypes)', () => {
    // exactOptionalPropertyTypes: missing optional MUST NOT be assignable
    // from `undefined`. Confirm by constructing an Issue without `range`.
    const issue: Issue = {
      kind: 'unused-files',
      severity: 'error',
      file: '/abs/path/file.ts',
      message: 'unused',
    };
    expect(issue.range).toBeUndefined();
    expect(issue.suggestions).toBeUndefined();
  });

  it('rejects unknown severity values in an Issue', () => {
    expectTypeOf<Issue>().not.toMatchTypeOf<{ severity: 'unknown' }>();
  });

  it('rejects unknown kind values in an Issue', () => {
    expectTypeOf<Issue>().not.toMatchTypeOf<{ kind: 'made-up-kind' }>();
  });

  it('suggestions, when present, is a readonly array of Action', () => {
    const issue: Issue = {
      kind: 'unused-exports',
      severity: 'warn',
      file: '/abs/path/file.ts',
      message: 'unused export',
      suggestions: [
        {
          kind: 'remove-export',
          file: '/abs/path/file.ts',
          range: {
            start: { line: 1, column: 0, byteOffset: 0 },
            end: { line: 1, column: 10, byteOffset: 10 },
          },
          exportName: 'foo',
        },
      ],
    };
    expect(issue.suggestions?.length).toBe(1);
  });
});

describe('Action', () => {
  it('is a discriminated union over the 6 kinds', () => {
    type ActionKind = Action['kind'];
    expectTypeOf<ActionKind>().toEqualTypeOf<
      | 'remove-export'
      | 'remove-import'
      | 'remove-file'
      | 'rewrite-line'
      | 'remove-enum-member'
      | 'remove-class-member'
    >();
  });

  it('remove-export carries file, range, and exportName', () => {
    const action: Action = {
      kind: 'remove-export',
      file: '/abs/path/file.ts',
      range: {
        start: { line: 1, column: 0, byteOffset: 0 },
        end: { line: 1, column: 10, byteOffset: 10 },
      },
      exportName: 'foo',
    };
    expect(action.kind).toBe('remove-export');
  });

  it('remove-import carries file, range, and importedName', () => {
    const action: Action = {
      kind: 'remove-import',
      file: '/abs/path/file.ts',
      range: {
        start: { line: 1, column: 0, byteOffset: 0 },
        end: { line: 1, column: 10, byteOffset: 10 },
      },
      importedName: 'bar',
    };
    expect(action.kind).toBe('remove-import');
  });

  it('remove-file carries only file', () => {
    const action: Action = {
      kind: 'remove-file',
      file: '/abs/path/file.ts',
    };
    expect(action.kind).toBe('remove-file');
  });

  it('rewrite-line carries file, line, newContent', () => {
    const action: Action = {
      kind: 'rewrite-line',
      file: '/abs/path/file.ts',
      line: 42,
      newContent: 'export const x = 1;',
    };
    expect(action.kind).toBe('rewrite-line');
  });

  it('remove-enum-member carries file, range, and memberName', () => {
    const action: Action = {
      kind: 'remove-enum-member',
      file: '/abs/path/file.ts',
      range: {
        start: { line: 1, column: 0, byteOffset: 0 },
        end: { line: 1, column: 10, byteOffset: 10 },
      },
      memberName: 'X',
    };
    expect(action.kind).toBe('remove-enum-member');
  });

  it('remove-class-member carries file, range, and memberName', () => {
    const action: Action = {
      kind: 'remove-class-member',
      file: '/abs/path/file.ts',
      range: {
        start: { line: 1, column: 0, byteOffset: 0 },
        end: { line: 1, column: 10, byteOffset: 10 },
      },
      memberName: 'method',
    };
    expect(action.kind).toBe('remove-class-member');
  });

  it('rejects an unknown kind', () => {
    // @ts-expect-error — 'rename-symbol' is not in the Action union
    const _bad: Action = { kind: 'rename-symbol', file: '/x' };
    void _bad;
  });

  it('narrows correctly via discriminant', () => {
    const action: Action = {
      kind: 'remove-file',
      file: '/abs/path/file.ts',
    };
    if (action.kind === 'remove-file') {
      // @ts-expect-error — remove-file does not carry exportName
      void action.exportName;
      expect(action.file).toBe('/abs/path/file.ts');
    }
  });
});
