/**
 * sc-17-18.test.ts — Phase 3m T293 — SC-17 + SC-18 acceptance row.
 *
 *   - SC-17: No `license` / `JWT` / `Ed25519` / `grace` / `watermark` /
 *            `sidecar` / `paid` / `enterprise` strings appear in user-facing
 *            paths under `packages/<*>/src/`.
 *   - SC-18: No `FALLOW_*` env-var reads.
 *
 * Both contracts are enforced by the existing scanners under `tools/`:
 *   - `tools/forbidden-strings.ts` (SC-17)
 *   - `tools/forbidden-env.ts` (SC-18)
 *
 * This test re-runs them as a child process and asserts exit code 0,
 * which is what the CI gate enforces. The rich token list and allowlist
 * live in the scanners themselves and must NOT be duplicated here (single
 * source of truth, per ADR-style discipline).
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');

interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runBun(scriptPath: string): Promise<RunResult> {
  return await new Promise<RunResult>((resolveResult, reject) => {
    const child = spawn('bun', [scriptPath], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (b) => {
      stdout += b.toString();
    });
    child.stderr?.on('data', (b) => {
      stderr += b.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolveResult({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

describe('SC-17: forbidden-strings gate', () => {
  it('tools/forbidden-strings.ts exits 0 (zero violations across packages/<*>/src/)', async () => {
    const result = await runBun('tools/forbidden-strings.ts');
    expect(result.exitCode, `forbidden-strings reported violations:\n${result.stderr}`).toBe(0);
  }, 60_000);
});

describe('SC-18: forbidden-FALLOW_-env gate', () => {
  it('tools/forbidden-env.ts exits 0 (zero FALLOW_ env reads)', async () => {
    const result = await runBun('tools/forbidden-env.ts');
    expect(result.exitCode, `forbidden-env reported violations:\n${result.stderr}`).toBe(0);
  }, 60_000);
});
