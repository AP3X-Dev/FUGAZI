/**
 * py-runner.ts — Phase 4f T373 — Python ecosystem regression runner.
 *
 * Walks the entries in `py-projects.json`, shallow-clones each, runs
 *   `bunx fugazi audit --format json --quiet`
 * inside the optional subdirectory, and asserts:
 *
 *   1. exit code ≤ 1            (0 = no findings, 1 = findings present)
 *   2. no panic (stderr does not contain `fugazi crashed`)
 *   3. wall-clock ≤ 120 s per project (Python repos are larger / slower than
 *      TS — relaxed from the 60 s TS budget)
 *
 * Designed to run in a weekly cron CI job, NOT on every PR. The runner is
 * gated by SKIP_ECOSYSTEM=1 (default in CI without explicit opt-in) so it
 * never blocks local `bun run test` invocations.
 *
 * Determinism contract: two consecutive runs against the same upstream SHA
 * must produce byte-identical issue lists. We don't enforce that here (the
 * upstream repo can change between fetches); the per-fixture tests cover
 * deterministic shape.
 *
 * Network safety: clones are shallow (`--depth 1`) and time-boxed via
 * AbortController. Failures inside one project do NOT abort the sweep —
 * every entry runs to completion and the runner reports an aggregate
 * pass/fail count at the end.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface PyEcosystemProject {
  readonly org: string;
  readonly repo: string;
  readonly branch: string;
  readonly subdir: string | null;
  readonly install_command: string;
}

export interface PyEcosystemResult {
  readonly project: PyEcosystemProject;
  readonly status: 'ok' | 'fail';
  readonly exitCode: number;
  readonly elapsedMs: number;
  readonly stderrTail: string;
}

const FUGAZI_TIMEOUT_MS = 120_000;
const CLONE_TIMEOUT_MS = 180_000;
const FUGAZI_CRASH_MARKER = 'fugazi crashed';

export async function loadPyProjects(): Promise<readonly PyEcosystemProject[]> {
  const raw = await readFile(resolve(HERE, 'py-projects.json'), 'utf8');
  const parsed = JSON.parse(raw) as readonly PyEcosystemProject[];
  return parsed;
}

function runChild(
  cmd: string,
  args: readonly string[],
  options: { cwd?: string; timeoutMs: number },
): Promise<{ exitCode: number; stderrTail: string; elapsedMs: number; timedOut: boolean }> {
  return new Promise((resolveP) => {
    const startedAt = Date.now();
    const child = spawn(cmd, args, {
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let stderrBuf = '';
    let stdoutDrained = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutDrained += chunk.toString('utf8');
      if (stdoutDrained.length > 16_384) {
        stdoutDrained = stdoutDrained.slice(-16_384);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
      if (stderrBuf.length > 4_096) {
        stderrBuf = stderrBuf.slice(-4_096);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolveP({
        exitCode: code ?? -1,
        stderrTail: stderrBuf,
        elapsedMs: Date.now() - startedAt,
        timedOut,
      });
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolveP({
        exitCode: -1,
        stderrTail: stderrBuf,
        elapsedMs: Date.now() - startedAt,
        timedOut,
      });
    });
  });
}

export async function runPyOne(project: PyEcosystemProject): Promise<PyEcosystemResult> {
  const workdir = await mkdtemp(join(tmpdir(), `fugazi-eco-py-${project.org}-${project.repo}-`));
  const repoDir = join(workdir, project.repo);

  const url = `https://github.com/${project.org}/${project.repo}.git`;
  const clone = await runChild(
    'git',
    ['clone', '--depth', '1', '--branch', project.branch, url, repoDir],
    { timeoutMs: CLONE_TIMEOUT_MS },
  );
  if (clone.exitCode !== 0) {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
    return {
      project,
      status: 'fail',
      exitCode: clone.exitCode,
      elapsedMs: clone.elapsedMs,
      stderrTail: clone.stderrTail,
    };
  }

  const cwd = project.subdir === null ? repoDir : join(repoDir, project.subdir);

  const audit = await runChild('bunx', ['fugazi', 'audit', '--format', 'json', '--quiet'], {
    cwd,
    timeoutMs: FUGAZI_TIMEOUT_MS,
  });

  await rm(workdir, { recursive: true, force: true }).catch(() => {});

  const isPanic = audit.stderrTail.includes(FUGAZI_CRASH_MARKER);
  const okExit = audit.exitCode === 0 || audit.exitCode === 1;
  const onTime = audit.elapsedMs <= FUGAZI_TIMEOUT_MS && !audit.timedOut;
  const status = okExit && onTime && !isPanic ? 'ok' : 'fail';

  return {
    project,
    status,
    exitCode: audit.exitCode,
    elapsedMs: audit.elapsedMs,
    stderrTail: audit.stderrTail,
  };
}

export async function runPyAll(): Promise<readonly PyEcosystemResult[]> {
  const projects = await loadPyProjects();
  const results: PyEcosystemResult[] = [];
  for (const project of projects) {
    // eslint-disable-next-line no-console
    console.log(`[ecosystem-py] ${project.org}/${project.repo}@${project.branch}`);
    // eslint-disable-next-line no-await-in-loop
    const result = await runPyOne(project);
    results.push(result);
  }
  return results;
}

async function main(): Promise<void> {
  if (process.env.SKIP_ECOSYSTEM === '1') {
    // eslint-disable-next-line no-console
    console.log('[ecosystem-py] SKIP_ECOSYSTEM=1, skipping');
    return;
  }
  const results = await runPyAll();
  const fails = results.filter((r) => r.status === 'fail');
  // eslint-disable-next-line no-console
  console.log(
    `[ecosystem-py] ${results.length - fails.length}/${results.length} passed (${fails.length} failed)`,
  );
  if (fails.length > 0) {
    for (const r of fails) {
      // eslint-disable-next-line no-console
      console.log(
        `  fail: ${r.project.org}/${r.project.repo} exit=${r.exitCode} elapsed=${r.elapsedMs}ms`,
      );
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
