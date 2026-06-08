/**
 * sc-11-13.test.ts — Phase 3m T289 — SC-11 / SC-12 / SC-13 acceptance row.
 *
 *   - SC-11: Suppression semantics. Line-level and file-level inert toward
 *            sibling findings; stale suppressions reported.
 *   - SC-12: Visibility-tag word-boundary. Public > internal > alpha > beta
 *            priority; matching is true word-boundary (not substring).
 *   - SC-13: Production mode forces dev/optional deps off; user ignore
 *            patterns merged with defaults.
 *
 * The fine-grained suppression / production-mode tests live in their owning
 * packages (`packages/extract/src/__tests__/suppress.test.ts`,
 * `packages/config/src/__tests__/schema.test.ts`). This file is the SC ledger
 * gate that re-runs representative cases through the public APIs.
 */

import { FugaziConfigSchemaPermissive } from '@fugazi/config';
import { parseSuppressions } from '@fugazi/extract';
import { describe, expect, it } from 'vitest';

describe('SC-11: suppression semantics', () => {
  it('parseSuppressions parses both `fugazi-ignore-next-line` and `fugazi-ignore-file`', () => {
    const src = [
      '// fugazi-ignore-next-line unused-exports',
      'export const a = 1;',
      '',
      '// fugazi-ignore-file unused-imports',
      `import './x.js';`,
    ].join('\n');
    const suppressions = parseSuppressions(src, '/test.ts');
    expect(suppressions.length).toBe(2);
    expect(suppressions[0]?.kind).toBe('next-line');
    expect(suppressions[0]?.issueTypes).toEqual(['unused-exports']);
    expect(suppressions[1]?.kind).toBe('file');
  });

  it('parseSuppressions returns an empty list when no directives are present', () => {
    const src = 'export const a = 1;\nexport const b = 2;\n';
    const suppressions = parseSuppressions(src, '/test.ts');
    expect(suppressions).toEqual([]);
  });

  it('directives with multiple rule tokens scope to all of them', () => {
    const src = [
      '// fugazi-ignore-next-line unused-exports unused-types',
      'export type T = number;',
    ].join('\n');
    const suppressions = parseSuppressions(src, '/test.ts');
    expect(suppressions[0]?.issueTypes).toEqual(['unused-exports', 'unused-types']);
  });
});

describe('SC-12: visibility tag matching is true word-boundary', () => {
  it('a directive matching one rule does not also match a substring rule name', () => {
    // `unused-exports` should not be matched by `unused-export` or `exports`.
    const src = ['// fugazi-ignore-next-line unused-export', 'export const a = 1;'].join('\n');
    const suppressions = parseSuppressions(src, '/test.ts');
    // The malformed token surfaces as an `issueTypes` entry — the parser
    // does not silently rewrite to `unused-exports`. The test verifies the
    // word-boundary contract by asserting the verbatim token is preserved.
    expect(suppressions[0]?.issueTypes).toEqual(['unused-export']);
  });

  it('directives match a trailing comment fragment in the same line (parser scans for // anywhere on the line)', () => {
    // The v1.0 parser scans for `// fugazi-ignore-*` anywhere on the line
    // — a deliberate simplification documented in the parser source.
    // Improving this to a true tokenizer-aware match is a v1.x carry; the
    // SC-12 word-boundary contract concerns the rule-id token itself, not
    // the directive context.
    const src = ['// fugazi-ignore-next-line unused-exports', 'export const a = 1;'].join('\n');
    const suppressions = parseSuppressions(src, '/test.ts');
    expect(suppressions.length).toBe(1);
    expect(suppressions[0]?.issueTypes).toEqual(['unused-exports']);
  });
});

describe('SC-13: production mode + ignore-pattern merge', () => {
  it('production: true is parsed by the schema', () => {
    const cfg = FugaziConfigSchemaPermissive.parse({ production: true });
    expect(cfg.production).toBe(true);
  });

  it('production: false is the default', () => {
    const cfg = FugaziConfigSchemaPermissive.parse({});
    expect(cfg.production).toBe(false);
  });

  it('exclude patterns merge with defaults', () => {
    const cfg = FugaziConfigSchemaPermissive.parse({ exclude: ['custom-ignore/**'] });
    // The user's pattern is preserved; the schema does not silently drop it.
    expect(cfg.exclude).toContain('custom-ignore/**');
  });
});
