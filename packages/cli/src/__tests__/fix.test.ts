/**
 * fix.test.ts — Phase 3h.6 (T211-T214) — `fugazi fix` CLI dispatch.
 */
import { describe, expect, it } from 'vitest';
import { runCli } from '../cli.js';
import { makeContext, withTempProject } from './helpers.js';

const FIXTURE = {
  'src/a.ts': 'export const a = 1;\n',
  'package.json': '{ "name": "fixture", "version": "0.0.0" }\n',
} as const;

describe('fugazi fix', () => {
  it('exits 0 when no fixes are needed', async () => {
    await withTempProject(FIXTURE, async (root) => {
      const ctx = makeContext();
      const cwd = process.cwd();
      process.chdir(root);
      try {
        const code = await runCli(['fix'], ctx);
        expect(code).toBe(0);
        // No fixes means the engine emits no per-file lines; the command
        // prints "fix: no fixes needed" to stdout.
        expect(ctx.getStdout()).toContain('fix: no fixes needed');
      } finally {
        process.chdir(cwd);
      }
    });
  });

  it('--dry-run exits 0 and prints zero-fix line when no fixes are queued', async () => {
    await withTempProject(FIXTURE, async (root) => {
      const ctx = makeContext();
      const cwd = process.cwd();
      process.chdir(root);
      try {
        const code = await runCli(['fix', '--dry-run'], ctx);
        expect(code).toBe(0);
        expect(ctx.getStdout()).toContain('dry-run: no fixes needed');
      } finally {
        process.chdir(cwd);
      }
    });
  });

  it('--rule filter is parsed', async () => {
    await withTempProject(FIXTURE, async (root) => {
      const ctx = makeContext();
      const cwd = process.cwd();
      process.chdir(root);
      try {
        const code = await runCli(['fix', '--rule', 'unused-imports', '--dry-run'], ctx);
        expect(code).toBe(0);
      } finally {
        process.chdir(cwd);
      }
    });
  });
});
