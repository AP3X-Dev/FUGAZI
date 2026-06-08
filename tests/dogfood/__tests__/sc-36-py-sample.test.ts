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
 *
 * SC-36 target: total findings <5% of file count after `.fugazirc.json`
 * config. The current Python pipeline carries known limitations that
 * exceed this bar at the toy-fixture scale (pyproject deps not consulted
 * by the Python resolver yet, package-init-not-reachable, BaseModel field
 * usage not tracked). Each finding is a known v1.x limitation — the rule
 * code is NOT suppressed to make the count drop, since that would
 * invalidate the dogfood signal.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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

  it('SC-36 threshold: finding count is <5% of file count after carry-tightening', async () => {
    // Phase 4f T381 — after the three carry-tightening fixes (manifest
    // loading, submodule promotion, AnnAssign-class-member exemption),
    // py-sample emits 0 findings. The 5% bar against 8 files rounds to
    // 0, so the assertion is "no findings". Regressions show up here
    // before the byte-equality fixtures notice.
    if (!existsSync(FUGAZI_BIN)) return;
    const result = await runFugazi(['dead-code', '--format', 'json', '--quiet']);
    const report = JSON.parse(result.stdout) as {
      readonly issues: readonly unknown[];
      readonly metrics: {
        readonly filesByLang: { readonly py: number };
      };
    };
    const fileCount = report.metrics.filesByLang.py;
    const findingCount = report.issues.length;
    const ratio = fileCount === 0 ? 0 : findingCount / fileCount;
    // Hard bar: <5% per the SC-36 contract. py-sample after fixes = 0.
    expect(ratio).toBeLessThan(0.05);
  }, 120_000);
});
