/**
 * fix-tools.test.ts — Phase 3h.6 — `fix_apply` / `fix_dry_run` /
 * `coverage_setup` against real fixtures.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { coverageSetupTool } from '../tools/coverage-setup.js';
import { fixApplyTool } from '../tools/fix-apply.js';
import { fixDryRunTool } from '../tools/fix-dry-run.js';
import { withValidation } from '../validate.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fugazi-mcp-test-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('fix_apply tool', () => {
  it('runs end-to-end against a fixture and emits a meta envelope', async () => {
    await writeFile(join(root, 'package.json'), '{"name":"fx"}', 'utf8');
    await writeFile(join(root, 'a.ts'), 'export const a = 1;\n', 'utf8');
    const wrapped = withValidation(fixApplyTool.schema, fixApplyTool.handler);
    const result = await wrapped({ projectRoot: root });
    expect(result.error).toBeFalsy();
    if (result.error !== true) {
      expect(result.data.applied).toBe(0);
      expect(result.data.errors).toBe(0);
      expect(result.data.dryRun).toBe(false);
      expect(result._meta.schemaVersion).toBe(1);
    }
  });

  it('respects dryRun flag', async () => {
    await writeFile(join(root, 'package.json'), '{"name":"fx"}', 'utf8');
    const wrapped = withValidation(fixApplyTool.schema, fixApplyTool.handler);
    const result = await wrapped({ projectRoot: root, dryRun: true });
    expect(result.error).toBeFalsy();
    if (result.error !== true) {
      expect(result.data.dryRun).toBe(true);
    }
  });

  it('is the lone MutatingTool', () => {
    expect(fixApplyTool.mode).toBe('mutate');
  });
});

describe('fix_dry_run tool', () => {
  it('runs and returns a plan without writing', async () => {
    await writeFile(join(root, 'package.json'), '{"name":"fx"}', 'utf8');
    await writeFile(join(root, 'a.ts'), 'export const a = 1;\n', 'utf8');
    const wrapped = withValidation(fixDryRunTool.schema, fixDryRunTool.handler);
    const result = await wrapped({ projectRoot: root });
    expect(result.error).toBeFalsy();
    if (result.error !== true) {
      expect(Array.isArray(result.data.plan)).toBe(true);
      expect(typeof result.data.fileCount).toBe('number');
    }
    // File untouched.
    const after = await readFile(join(root, 'a.ts'), 'utf8');
    expect(after).toBe('export const a = 1;\n');
  });

  it('is read-only', () => {
    expect(fixDryRunTool.mode).toBe('read');
  });
});

describe('coverage_setup tool', () => {
  it('emits snippet entries when vitest is detected', async () => {
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fx', devDependencies: { vitest: '^2.0.0' } }),
      'utf8',
    );
    const wrapped = withValidation(coverageSetupTool.schema, coverageSetupTool.handler);
    const result = await wrapped({ projectRoot: root });
    expect(result.error).toBeFalsy();
    if (result.error !== true) {
      expect(result.data.detected).toEqual(['vitest']);
      expect(result.data.snippets).toHaveLength(1);
      expect(result.data.snippets[0]?.runner).toBe('vitest');
      expect(result.data.snippets[0]?.snippet).toContain("provider: 'v8'");
    }
  });

  it('returns the verbatim error when no runner is detected', async () => {
    await writeFile(join(root, 'package.json'), '{"name":"fx"}', 'utf8');
    const wrapped = withValidation(coverageSetupTool.schema, coverageSetupTool.handler);
    const result = await wrapped({ projectRoot: root });
    expect(result.error).toBe(true);
    if (result.error === true) {
      expect(result.message).toBe(
        'coverage-setup: no supported test runner detected (looked for vitest, jest, playwright)',
      );
    }
  });

  it('is read-only', () => {
    expect(coverageSetupTool.mode).toBe('read');
  });
});
