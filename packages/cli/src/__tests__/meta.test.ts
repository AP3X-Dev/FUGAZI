/**
 * meta.test.ts — Phase 3h.2 — `init`, `schema`, `explain`.
 *
 * `init`     writes `.fugazirc.json`; refuses without `--force` when present.
 * `schema`   prints the JSON Schema (and `--markdown` rendering); both are
 *            byte-reproducible across runs (NFR-1).
 * `explain`  prints a Markdown blurb mentioning the rule id; unknown rules
 *            exit 2.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../cli.js';
import { makeContext, withTempProject } from './helpers.js';

describe('init', () => {
  it('writes .fugazirc.json on first run', async () => {
    await withTempProject(
      { 'package.json': '{ "name": "x", "version": "0.0.0" }' },
      async (root) => {
        const cwd = process.cwd();
        process.chdir(root);
        try {
          const ctx = makeContext();
          const code = await runCli(['init'], ctx);
          expect(code).toBe(0);
          const target = join(root, '.fugazirc.json');
          expect(existsSync(target)).toBe(true);
          const body = await readFile(target, 'utf8');
          expect(body).toContain('"rules"');
          expect(body).toContain('"frameworks"');
          // Documents entry-point auto-detection + the override path as a
          // commented example, so no active `entrypoints` array is pinned and
          // inference stays on.
          expect(body).toContain('//   "entrypoints"');
        } finally {
          process.chdir(cwd);
        }
      },
    );
  });

  it('refuses to overwrite without --force using the verbatim message', async () => {
    await withTempProject({ '.fugazirc.json': '{}\n', 'package.json': '{}' }, async (root) => {
      const cwd = process.cwd();
      process.chdir(root);
      try {
        const ctx = makeContext();
        const code = await runCli(['init'], ctx);
        expect(code).toBe(2);
        expect(ctx.getStderr()).toBe(
          'fugazi init: .fugazirc.json already exists; pass --force to overwrite\n',
        );
      } finally {
        process.chdir(cwd);
      }
    });
  });

  it('--force overwrites an existing config', async () => {
    await withTempProject(
      { '.fugazirc.json': '{ "stale": true }', 'package.json': '{}' },
      async (root) => {
        const cwd = process.cwd();
        process.chdir(root);
        try {
          const ctx = makeContext();
          const code = await runCli(['init', '--force'], ctx);
          expect(code).toBe(0);
          const body = await readFile(join(root, '.fugazirc.json'), 'utf8');
          expect(body).not.toContain('stale');
        } finally {
          process.chdir(cwd);
        }
      },
    );
  });

  it('init output is deterministic across runs', async () => {
    const fixture = {
      'package.json': '{ "name": "x", "dependencies": { "react": "^18", "vitest": "^2" } }',
    };
    await withTempProject(fixture, async (rootA) => {
      const cwdA = process.cwd();
      process.chdir(rootA);
      let bodyA = '';
      try {
        await runCli(['init'], makeContext());
        bodyA = await readFile(join(rootA, '.fugazirc.json'), 'utf8');
      } finally {
        process.chdir(cwdA);
      }
      await withTempProject(fixture, async (rootB) => {
        const cwdB = process.cwd();
        process.chdir(rootB);
        try {
          await runCli(['init'], makeContext());
          const bodyB = await readFile(join(rootB, '.fugazirc.json'), 'utf8');
          expect(bodyA).toBe(bodyB);
        } finally {
          process.chdir(cwdB);
        }
      });
    });
  });
});

describe('schema', () => {
  it('emits a JSON schema by default', async () => {
    const ctx = makeContext();
    const code = await runCli(['schema'], ctx);
    expect(code).toBe(0);
    const out = ctx.getStdout();
    const parsed = JSON.parse(out);
    expect(typeof parsed).toBe('object');
    expect(parsed).not.toBeNull();
  });

  it('--markdown emits a deterministic markdown table', async () => {
    const a = makeContext();
    const b = makeContext();
    await runCli(['schema', '--markdown'], a);
    await runCli(['schema', '--markdown'], b);
    expect(a.getStdout()).toBe(b.getStdout());
    expect(a.getStdout()).toContain('# Fugazi configuration schema');
    expect(a.getStdout()).toContain('| field |');
  });

  it('JSON output is byte-reproducible across runs', async () => {
    const a = makeContext();
    const b = makeContext();
    await runCli(['schema'], a);
    await runCli(['schema'], b);
    expect(a.getStdout()).toBe(b.getStdout());
  });
});

describe('explain', () => {
  it('explain unused-files prints a description containing the rule name', async () => {
    const ctx = makeContext();
    const code = await runCli(['explain', 'unused-files'], ctx);
    expect(code).toBe(0);
    expect(ctx.getStdout()).toContain('unused-files');
    expect(ctx.getStdout()).toContain('Severity');
  });

  it('explain bogus-rule exits 2 with an error message', async () => {
    const ctx = makeContext();
    const code = await runCli(['explain', 'bogus-rule'], ctx);
    expect(code).toBe(2);
    expect(ctx.getStderr()).toContain('unknown rule id');
  });
});
