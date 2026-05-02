/**
 * cli.test.ts — Phase 3h.2 — CLI registry + --ci rejection.
 *
 * Validates two cross-cutting contracts:
 *
 *   1. Every registered subcommand is reachable from the top-level help. The
 *      list is alphabetical (matches `--help` output order) and contains the
 *      full 17-name surface.
 *
 *   2. Passing `--ci` anywhere on the command line emits the verbatim
 *      `--ci is removed; use --preset ci instead` to stderr and exits 2 (per
 *      F1 / IMP-API-07).
 */
import { describe, expect, it } from 'vitest';
import { CI_REJECTION_MESSAGE, runCli } from '../cli.js';
import { ALL_COMMANDS } from '../commands/index.js';
import { makeContext } from './helpers.js';

const EXPECTED_PATHS = [
  'audit',
  'boundaries',
  'circular-deps',
  'coverage setup',
  'dead-code',
  'dupes',
  'explain',
  'fix',
  'health',
  'init',
  'schema',
  'trace',
  'unused-deps',
  'unused-exports',
  'unused-files',
  'unused-types',
  'watch',
];

describe('CLI registry', () => {
  it('registers all 17 subcommands', () => {
    expect(ALL_COMMANDS.length).toBe(17);
    const paths = ALL_COMMANDS.map((c) => {
      const head = c.paths?.[0] ?? [];
      return head.join(' ');
    });
    const sorted = [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(sorted).toEqual(EXPECTED_PATHS);
  });

  it('--help exits 0 and lists every subcommand', async () => {
    const ctx = makeContext();
    const code = await runCli(['--help'], ctx);
    expect(code).toBe(0);
    const out = ctx.getStdout() + ctx.getStderr();
    for (const path of EXPECTED_PATHS) {
      expect(out).toContain(path);
    }
  });
});

describe('--ci rejection', () => {
  it('rejects --ci with verbatim message and exit 2', async () => {
    const ctx = makeContext();
    const code = await runCli(['--ci', 'dead-code'], ctx);
    expect(code).toBe(2);
    expect(ctx.getStderr()).toBe(`${CI_REJECTION_MESSAGE}\n`);
    expect(ctx.getStdout()).toBe('');
  });

  it('rejects --ci even when placed after a subcommand', async () => {
    const ctx = makeContext();
    const code = await runCli(['dead-code', '--ci'], ctx);
    expect(code).toBe(2);
    expect(ctx.getStderr()).toBe(`${CI_REJECTION_MESSAGE}\n`);
  });
});
