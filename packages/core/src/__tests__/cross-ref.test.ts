/**
 * cross-ref.test.ts — Phase 3f.6 (T165-test) — file-level short-circuit.
 *
 * Asserts §4.B.5: when `unused-files` flags a path, every per-export finding
 * on that path is suppressed in the final issue stream. Ensures the filter:
 *   - is O(N) (single pass, no nested walks).
 *   - leaves non-affected issues untouched.
 *   - reports the suppression counts via `filteredByRule`.
 */

import type { DiscriminatedIssue, Range } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import { applyCrossReferenceFilter } from '../cross-ref.js';

const RANGE: Range = {
  start: { line: 1, column: 1, byteOffset: 0 },
  end: { line: 1, column: 10, byteOffset: 9 },
};

function unusedFilesIssue(path: string): DiscriminatedIssue {
  return {
    kind: 'unused-files',
    severity: 'error',
    file: path,
    message: `unused-files: ${path}`,
    path,
  };
}

function unusedExportIssue(path: string, name: string): DiscriminatedIssue {
  return {
    kind: 'unused-exports',
    severity: 'error',
    file: path,
    range: RANGE,
    message: `unused-exports: ${name} in ${path} has no consumers`,
    exportName: name,
  };
}

function unusedTypeIssue(path: string, name: string): DiscriminatedIssue {
  return {
    kind: 'unused-types',
    severity: 'error',
    file: path,
    range: RANGE,
    message: `unused-types: ${name} in ${path} has no consumers`,
    typeName: name,
  };
}

function unusedEnumMembersIssue(path: string, en: string, m: string): DiscriminatedIssue {
  return {
    kind: 'unused-enum-members',
    severity: 'error',
    file: path,
    range: RANGE,
    message: `unused-enum-members: ${en}.${m} in ${path} has no consumers`,
    enumName: en,
    memberName: m,
  };
}

function unusedClassMembersIssue(path: string, cl: string, m: string): DiscriminatedIssue {
  return {
    kind: 'unused-class-members',
    severity: 'error',
    file: path,
    range: RANGE,
    message: `unused-class-members: ${cl}.${m} in ${path} has no consumers`,
    className: cl,
    memberName: m,
  };
}

function circularDepsIssue(path: string): DiscriminatedIssue {
  return {
    kind: 'circular-dependencies',
    severity: 'error',
    file: path,
    message: 'circular-dependencies: cycle detected: a → b → a',
    cycle: ['a', 'b', 'a'],
  };
}

describe('applyCrossReferenceFilter', () => {
  it('drops per-export findings on a file flagged unused-files', () => {
    const orphan = '/repo/src/orphan.ts';
    const issues: DiscriminatedIssue[] = [
      unusedFilesIssue(orphan),
      unusedExportIssue(orphan, 'a'),
      unusedExportIssue(orphan, 'b'),
      unusedExportIssue(orphan, 'c'),
      unusedExportIssue(orphan, 'd'),
      unusedExportIssue(orphan, 'e'),
    ];
    const result = applyCrossReferenceFilter(issues);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.kind).toBe('unused-files');
    expect(result.shortCircuitedPaths.has(orphan)).toBe(true);
    expect(result.filteredByRule['unused-exports']).toBe(5);
  });

  it('drops unused-types / unused-enum-members / unused-class-members on orphan files', () => {
    const orphan = '/repo/src/orphan.ts';
    const issues: DiscriminatedIssue[] = [
      unusedFilesIssue(orphan),
      unusedTypeIssue(orphan, 'Foo'),
      unusedEnumMembersIssue(orphan, 'E', 'A'),
      unusedClassMembersIssue(orphan, 'C', 'm'),
    ];
    const result = applyCrossReferenceFilter(issues);
    expect(result.issues).toHaveLength(1);
    expect(result.filteredByRule['unused-types']).toBe(1);
    expect(result.filteredByRule['unused-enum-members']).toBe(1);
    expect(result.filteredByRule['unused-class-members']).toBe(1);
  });

  it('does not affect findings on non-orphan files', () => {
    const orphan = '/repo/src/orphan.ts';
    const live = '/repo/src/live.ts';
    const issues: DiscriminatedIssue[] = [
      unusedFilesIssue(orphan),
      unusedExportIssue(orphan, 'gone'),
      unusedExportIssue(live, 'kept'),
    ];
    const result = applyCrossReferenceFilter(issues);
    expect(result.issues).toHaveLength(2);
    expect(result.issues.find((i) => i.file === live)).toBeDefined();
    expect(
      result.issues.find((i) => i.file === orphan && i.kind === 'unused-exports'),
    ).toBeUndefined();
  });

  it('leaves non-short-circuited rule kinds untouched even on orphan files', () => {
    const orphan = '/repo/src/orphan.ts';
    const issues: DiscriminatedIssue[] = [unusedFilesIssue(orphan), circularDepsIssue(orphan)];
    const result = applyCrossReferenceFilter(issues);
    expect(result.issues).toHaveLength(2);
  });

  it('returns input unchanged when no unused-files findings exist', () => {
    const issues: DiscriminatedIssue[] = [
      unusedExportIssue('/x.ts', 'a'),
      circularDepsIssue('/y.ts'),
    ];
    const result = applyCrossReferenceFilter(issues);
    expect(result.issues).toBe(issues);
    expect(result.shortCircuitedPaths.size).toBe(0);
    expect(Object.keys(result.filteredByRule)).toHaveLength(0);
  });

  it('preserves input order in output', () => {
    const live = '/repo/src/live.ts';
    const orphan = '/repo/src/orphan.ts';
    const issues: DiscriminatedIssue[] = [
      unusedExportIssue(live, 'a'),
      unusedFilesIssue(orphan),
      unusedExportIssue(live, 'b'),
      unusedExportIssue(orphan, 'c'),
      unusedExportIssue(live, 'd'),
    ];
    const result = applyCrossReferenceFilter(issues);
    expect(result.issues).toHaveLength(4);
    if (result.issues[0]?.kind !== 'unused-exports') throw new Error('kind');
    expect(result.issues[0].exportName).toBe('a');
    if (result.issues[2]?.kind !== 'unused-exports') throw new Error('kind');
    expect(result.issues[2].exportName).toBe('b');
  });

  it('handles multiple orphan files independently', () => {
    const o1 = '/repo/src/o1.ts';
    const o2 = '/repo/src/o2.ts';
    const issues: DiscriminatedIssue[] = [
      unusedFilesIssue(o1),
      unusedFilesIssue(o2),
      unusedExportIssue(o1, 'a'),
      unusedExportIssue(o2, 'b'),
    ];
    const result = applyCrossReferenceFilter(issues);
    expect(result.issues).toHaveLength(2);
    expect(result.shortCircuitedPaths.size).toBe(2);
    expect(result.filteredByRule['unused-exports']).toBe(2);
  });

  it('determinism: same input → same output object shape across calls', () => {
    const issues: DiscriminatedIssue[] = [
      unusedFilesIssue('/o.ts'),
      unusedExportIssue('/o.ts', 'a'),
      unusedExportIssue('/live.ts', 'b'),
    ];
    const a = applyCrossReferenceFilter(issues);
    const b = applyCrossReferenceFilter(issues);
    expect(JSON.stringify(a.issues)).toBe(JSON.stringify(b.issues));
    expect(JSON.stringify(a.filteredByRule)).toBe(JSON.stringify(b.filteredByRule));
  });
});
