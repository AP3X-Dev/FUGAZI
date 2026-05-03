/**
 * coverage-setup.test.ts — Phase 3h.6 (T215-T217) — `fugazi coverage setup`.
 */
import { describe, expect, it } from 'vitest';
import { runCli } from '../cli.js';
import { makeContext, withTempProject } from './helpers.js';

describe('fugazi coverage setup', () => {
  it('emits vitest snippet when vitest is detected', async () => {
    await withTempProject(
      { 'package.json': JSON.stringify({ name: 'fx', devDependencies: { vitest: '^2' } }) },
      async (root) => {
        const ctx = makeContext();
        const cwd = process.cwd();
        process.chdir(root);
        try {
          const code = await runCli(['coverage', 'setup'], ctx);
          expect(code).toBe(0);
          expect(ctx.getStdout()).toContain('vitest');
          expect(ctx.getStdout()).toContain("provider: 'v8'");
        } finally {
          process.chdir(cwd);
        }
      },
    );
  });

  it('emits jest snippet when jest is detected', async () => {
    await withTempProject(
      { 'package.json': JSON.stringify({ name: 'fx', devDependencies: { jest: '^29' } }) },
      async (root) => {
        const ctx = makeContext();
        const cwd = process.cwd();
        process.chdir(root);
        try {
          const code = await runCli(['coverage', 'setup'], ctx);
          expect(code).toBe(0);
          expect(ctx.getStdout()).toContain('jest');
          expect(ctx.getStdout()).toContain("coverageProvider: 'v8'");
        } finally {
          process.chdir(cwd);
        }
      },
    );
  });

  it('exits 2 with verbatim error when no runner detected', async () => {
    await withTempProject(
      { 'package.json': JSON.stringify({ name: 'fx', devDependencies: { typescript: '^5' } }) },
      async (root) => {
        const ctx = makeContext();
        const cwd = process.cwd();
        process.chdir(root);
        try {
          const code = await runCli(['coverage', 'setup'], ctx);
          expect(code).toBe(2);
          expect(ctx.getStderr()).toBe(
            'coverage-setup: no supported test runner detected (looked for vitest, jest, playwright, pytest)\n',
          );
        } finally {
          process.chdir(cwd);
        }
      },
    );
  });
});
