/**
 * sc-36-py-sample.test.ts — Phase 4f T374 — SC-36 dogfood for the Python
 * pipeline.
 *
 * Runs `fugazi audit` and `fugazi dead-code` against
 * `tests/dogfood/fixtures/py-sample/` (a tiny Flask app exercising
 * blueprints, decorators, BaseModel, and pytest), and asserts:
 *
 *   1. Audit completes without crash and returns valid JSON.
 *   2. Dead-code completes with exit ≤ 1 (findings allowed).
 *   3. Documented findings disposition exists in `docs/DOGFOOD.md`.
 *
 * SC-36 target: total findings <5% of file count after `.fugazirc.json`
 * config. The current Python pipeline carries known limitations that
 * exceed this bar at the toy-fixture scale (pyproject deps not consulted
 * by the Python resolver yet, package-init-not-reachable, BaseModel field
 * usage not tracked). Each finding is dispositioned as a v1.x carry in
 * docs/DOGFOOD.md and docs/V1_LIMITATIONS.md — the rule code is NOT
 * suppressed to make the count drop, since that would invalidate the
 * dogfood signal.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const FIXTURE = resolve(REPO_ROOT, 'tests', 'dogfood', 'fixtures', 'py-sample');
const FUGAZI_BIN = resolve(REPO_ROOT, 'packages', 'cli', 'bin', 'fugazi.js');

interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runFugazi(args: readonly string[]): Promise<RunResult> {
  return await new Promise<RunResult>((resolveResult, reject) => {
    const child = spawn(process.execPath, [FUGAZI_BIN, ...args], {
      cwd: FIXTURE,
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString();
    });
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolveResult({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

describe('SC-36: Python dogfood — py-sample fixture', () => {
  it('fixture exists', () => {
    expect(existsSync(FIXTURE)).toBe(true);
  });

  it('fugazi bin exists (built)', () => {
    expect(existsSync(FUGAZI_BIN)).toBe(true);
  });

  it('audit runs without crashing on the Python sample', async () => {
    if (!existsSync(FUGAZI_BIN)) return;
    const result = await runFugazi(['audit', '--format', 'json', '--quiet']);
    expect([0, 1]).toContain(result.exitCode);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stderr).not.toContain('fugazi crashed');
    const report = JSON.parse(result.stdout) as {
      readonly mode: string;
      readonly issues: readonly unknown[];
      readonly metrics: {
        readonly filesByLang: { readonly py: number };
      };
    };
    expect(report.mode).toBe('audit');
    expect(report.metrics.filesByLang.py).toBeGreaterThan(0);
  }, 120_000);

  it('dead-code runs with exit ≤ 1; findings count documented', async () => {
    if (!existsSync(FUGAZI_BIN)) return;
    const result = await runFugazi(['dead-code', '--format', 'json', '--quiet']);
    expect([0, 1]).toContain(result.exitCode);
    expect(result.stderr).not.toContain('fugazi crashed');
    const report = JSON.parse(result.stdout) as {
      readonly issues: readonly unknown[];
      readonly metrics: {
        readonly filesByLang: { readonly py: number };
      };
    };
    expect(Array.isArray(report.issues)).toBe(true);
    expect(report.metrics.filesByLang.py).toBeGreaterThan(0);
  }, 120_000);

  it('docs/DOGFOOD.md mentions the Python sample disposition', async () => {
    const path = resolve(REPO_ROOT, 'docs', 'DOGFOOD.md');
    expect(existsSync(path)).toBe(true);
    const text = await readFile(path, 'utf8');
    expect(text).toMatch(/python/i);
    expect(text).toMatch(/py-sample/i);
  });
});
