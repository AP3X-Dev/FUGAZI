/**
 * sarif.property.test.ts — Phase 3k.7 — SARIF determinism property suite.
 *
 * Five fast-check property invariants over the SARIF reporter:
 *
 *   1. byte-determinism: emitting the same issue list twice produces byte-
 *      equal SARIF output.
 *   2. order-invariance: shuffled input produces the same output (the
 *      reporter does its own deterministic sort).
 *   3. URI normalization: every `physicalLocation.artifactLocation.uri` is
 *      forward-slash POSIX, regardless of input platform separators.
 *   4. version pin: every emitted run carries `version: "2.1.0"`.
 *   5. shape stability: required SARIF 2.1.0 fields are always present.
 *
 * 100 iterations per property — generous; each emit is sub-millisecond and
 * the suite is gated by SC-1 (byte-equality).
 */

import { fc, test as fctest } from '@fast-check/vitest';
import { SarifReporter } from '@fugazi/core';
import type { ReporterMeta } from '@fugazi/core';
import type { DiscriminatedIssue, Range, RuleId, Severity } from '@fugazi/types';
import { describe, expect } from 'vitest';

const RULE_IDS: readonly RuleId[] = [
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

const SEVERITIES: readonly Severity[] = ['error', 'warn', 'off'];

function sevArbitrary(): fc.Arbitrary<Severity> {
  return fc.constantFrom(...SEVERITIES);
}

function rangeArbitrary(): fc.Arbitrary<Range> {
  return fc
    .tuple(
      fc.integer({ min: 1, max: 100 }),
      fc.integer({ min: 0, max: 80 }),
      fc.integer({ min: 0, max: 1000 }),
    )
    .map(([line, column, byteOffset]) => ({
      start: { line, column, byteOffset },
      end: { line, column: column + 1, byteOffset: byteOffset + 1 },
    }));
}

/**
 * Path arbitrary that exercises URI-normalisation edge cases:
 *
 *   - mixed POSIX / Windows separators
 *   - square brackets (encode-as-`%5B%5D`-or-pass-through territory)
 *   - lowercase scheme (intentional — SARIF uses raw paths, not URIs)
 *   - parent traversal
 */
function pathArbitrary(): fc.Arbitrary<string> {
  return fc.constantFrom(
    'src/index.ts',
    'src\\windows\\path.ts',
    'src/[bracket]/file.ts',
    './src/relative.ts',
    '../parent/file.ts',
    'src/very/deep/nested/path/file.ts',
    'C:/Users/test/project/src/index.ts',
    'src/unicode/файл.ts',
  );
}

function issueArbitrary(): fc.Arbitrary<DiscriminatedIssue> {
  return fc
    .tuple(fc.constantFrom(...RULE_IDS), sevArbitrary(), pathArbitrary(), rangeArbitrary())
    .map(([kind, severity, file, range]) => {
      const base = {
        severity,
        file,
        range,
        message: `${kind}: synthetic finding`,
      };
      switch (kind) {
        case 'unused-files':
          return { kind, ...base, path: file } as DiscriminatedIssue;
        case 'unused-exports':
          return { kind, ...base, exportName: 'foo' } as DiscriminatedIssue;
        case 'unused-types':
          return { kind, ...base, typeName: 'Foo' } as DiscriminatedIssue;
        case 'unused-deps':
        case 'unused-dev-deps':
        case 'unused-optional-deps':
          return {
            kind,
            ...base,
            dependency: 'lodash',
            manifestPath: 'package.json',
          } as DiscriminatedIssue;
        case 'unused-enum-members':
          return {
            kind,
            ...base,
            enumName: 'E',
            memberName: 'A',
          } as DiscriminatedIssue;
        case 'unused-class-members':
          return {
            kind,
            ...base,
            className: 'C',
            memberName: 'm',
          } as DiscriminatedIssue;
        case 'circular-dependencies':
          return {
            kind,
            ...base,
            cycle: [file, file],
          } as DiscriminatedIssue;
        case 'boundary-violations':
          return {
            kind,
            ...base,
            from: file,
            to: file,
            fromZone: 'a',
            toZone: 'b',
          } as DiscriminatedIssue;
        case 'unresolved-imports':
        case 'unlisted-dependencies':
          return {
            kind,
            ...base,
            specifier: 'pkg',
          } as DiscriminatedIssue;
        case 'duplicate-exports':
          return {
            kind,
            ...base,
            occurrences: [{ file, range }],
            exportName: 'dup',
          } as DiscriminatedIssue;
        case 'private-type-leak':
          return {
            kind,
            ...base,
            leakedType: 'L',
            publicSymbol: 'S',
          } as DiscriminatedIssue;
        case 'complexity-hotspot':
          return {
            kind,
            ...base,
            score: 12,
            metric: 'cyclomatic' as const,
          } as DiscriminatedIssue;
        case 'cognitive-complexity':
          return {
            kind,
            ...base,
            score: 18,
          } as DiscriminatedIssue;
        case 'code-duplication':
          return {
            kind,
            ...base,
            occurrences: [{ file, range }],
            cloneType: 1 as const,
          } as DiscriminatedIssue;
        case 'cold-code':
          return {
            kind,
            ...base,
            executionCount: 0 as const,
          } as DiscriminatedIssue;
        case 'hot-path':
          return {
            kind,
            ...base,
            executionCount: 100,
          } as DiscriminatedIssue;
      }
    });
}

const META: ReporterMeta = {
  mode: 'full',
  version: '0.0.0',
  projectRoot: '/proj',
};

function emitOnce(issues: readonly DiscriminatedIssue[]): string {
  const reporter = new SarifReporter();
  reporter.begin(META);
  for (const issue of issues) reporter.emit(issue);
  const out = reporter.end();
  if (typeof out !== 'string') {
    throw new Error(`expected string output, got ${typeof out}`);
  }
  return out;
}

interface SarifShape {
  readonly $schema: string;
  readonly version: string;
  readonly runs: ReadonlyArray<{
    readonly tool: { readonly driver: { readonly rules: readonly unknown[] } };
    readonly results: ReadonlyArray<{
      readonly locations: ReadonlyArray<{
        readonly physicalLocation: { readonly artifactLocation: { readonly uri: string } };
      }>;
    }>;
  }>;
}

describe('SARIF determinism properties', () => {
  fctest.prop([fc.array(issueArbitrary(), { minLength: 0, maxLength: 12 })], {
    numRuns: 100,
  })('byte-determinism: same issue list emits identical SARIF', (issues) => {
    const a = emitOnce(issues);
    const b = emitOnce(issues);
    expect(b).toBe(a);
  });

  fctest.prop(
    [
      fc.array(issueArbitrary(), { minLength: 0, maxLength: 12 }),
      fc.integer({ min: 0, max: 1_000_000 }),
    ],
    { numRuns: 100 },
  )('order-invariance: shuffled input emits identical SARIF', (issues, seed) => {
    const baseline = emitOnce(issues);
    // Deterministic shuffle.
    const shuffled = [...issues];
    let s = seed >>> 0;
    const next = (): number => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const a = shuffled[i] as DiscriminatedIssue;
      const b = shuffled[j] as DiscriminatedIssue;
      shuffled[i] = b;
      shuffled[j] = a;
    }
    expect(emitOnce(shuffled)).toBe(baseline);
  });

  fctest.prop([fc.array(issueArbitrary(), { minLength: 1, maxLength: 8 })], {
    numRuns: 100,
  })('URI normalization: every artifact URI is forward-slash POSIX', (issues) => {
    const out = emitOnce(issues);
    const parsed = JSON.parse(out) as SarifShape;
    for (const result of parsed.runs[0]?.results ?? []) {
      for (const location of result.locations) {
        const uri = location.physicalLocation.artifactLocation.uri;
        expect(uri.includes('\\')).toBe(false);
      }
    }
  });

  fctest.prop([fc.array(issueArbitrary(), { minLength: 0, maxLength: 8 })], {
    numRuns: 100,
  })('version pin: every emit carries version "2.1.0"', (issues) => {
    const out = emitOnce(issues);
    const parsed = JSON.parse(out) as SarifShape;
    expect(parsed.version).toBe('2.1.0');
  });

  fctest.prop([fc.array(issueArbitrary(), { minLength: 0, maxLength: 8 })], {
    numRuns: 100,
  })('shape stability: required SARIF 2.1.0 fields are always present', (issues) => {
    const out = emitOnce(issues);
    const parsed = JSON.parse(out) as SarifShape;
    expect(typeof parsed.$schema).toBe('string');
    expect(typeof parsed.version).toBe('string');
    expect(Array.isArray(parsed.runs)).toBe(true);
    expect(parsed.runs.length).toBe(1);
    const run = parsed.runs[0];
    expect(run !== undefined).toBe(true);
    if (run !== undefined) {
      expect(Array.isArray(run.tool.driver.rules)).toBe(true);
      expect(Array.isArray(run.results)).toBe(true);
    }
    void issues;
  });
});
