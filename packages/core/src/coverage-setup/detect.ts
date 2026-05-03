/**
 * coverage-setup/detect.ts — Phase 3h.6 (T215-T217) — runner detection.
 *
 * Read the project's `package.json` and identify which test runners are
 * present (`vitest`, `jest`, or `playwright`). The wizard surfaces a per-runner
 * config snippet (see `./snippets.ts`) so users can capture V8 coverage that
 * Fugazi's runtime layer consumes.
 *
 * Phase 4e (T366) extended the detection set with `pytest`, surfaced when the
 * project root carries a Python manifest (`pyproject.toml`, `setup.cfg`,
 * `setup.py`, or `requirements*.txt`). Detection is a substring match against
 * the manifest contents (looking for `pytest`); the wizard emits a snippet
 * showing the standard `pytest --cov` flags so users in pure-Python or mixed
 * monorepos get a working coverage path. Pure addition — TS/JS detection
 * remains untouched.
 *
 * Detection semantics: a runner is "detected" iff its package name appears in
 * `dependencies`, `devDependencies`, or `optionalDependencies` (TS/JS) or its
 * marker text appears in the Python manifest set (Python). Workspace roots
 * that aggregate multiple runners surface every match (the wizard prints all
 * of them).
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type SupportedRunner = 'vitest' | 'jest' | 'playwright' | 'pytest';

export const SUPPORTED_RUNNERS: readonly SupportedRunner[] = [
  'vitest',
  'jest',
  'playwright',
  'pytest',
];

/** Verbatim error string used when no runner is detected. */
export const NO_RUNNER_MESSAGE =
  'coverage-setup: no supported test runner detected (looked for vitest, jest, playwright, pytest)';

export interface DetectRunnersOptions {
  readonly projectRoot: string;
}

/**
 * Detect which supported runners are listed in the project's package.json
 * (TS/JS) or Python manifest set (Python). Returns the set of detected
 * runners in canonical order (`vitest`, `jest`, `playwright`, `pytest`).
 *
 * Returns an empty array on read or parse failure — the wizard treats that
 * the same as "none detected" (the verbatim error is emitted by the caller).
 */
export async function detectRunners(
  options: DetectRunnersOptions,
): Promise<readonly SupportedRunner[]> {
  const detected: SupportedRunner[] = [];
  const merged = await readPackageDeps(options.projectRoot);
  for (const runner of ['vitest', 'jest', 'playwright'] as const) {
    if (merged.has(runner)) detected.push(runner);
  }
  if (await detectPytest(options.projectRoot)) {
    detected.push('pytest');
  }
  return Object.freeze(detected) as readonly SupportedRunner[];
}

async function readPackageDeps(projectRoot: string): Promise<ReadonlySet<string>> {
  const manifestPath = join(projectRoot, 'package.json');
  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch {
    return new Set<string>();
  }
  let pkg: unknown;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return new Set<string>();
  }
  if (pkg === null || typeof pkg !== 'object') {
    return new Set<string>();
  }
  return mergedDeps(pkg as Record<string, unknown>);
}

function mergedDeps(pkg: Record<string, unknown>): ReadonlySet<string> {
  const out = new Set<string>();
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    const v = pkg[key];
    if (v === null || typeof v !== 'object') continue;
    for (const dep of Object.keys(v as Record<string, unknown>)) {
      out.add(dep);
    }
  }
  return out;
}

/**
 * Phase 4e (T366): detect pytest by scanning the conventional Python
 * manifest set in canonical order. Substring match on `pytest` keeps the
 * detector tolerant of every reasonable declaration form (TOML table,
 * pinned version, comment), while still requiring an explicit mention so
 * the wizard doesn't fire on every project that happens to have a stray
 * `setup.cfg`. Returns `true` on the first hit.
 */
async function detectPytest(projectRoot: string): Promise<boolean> {
  const candidates = [
    'pyproject.toml',
    'setup.cfg',
    'setup.py',
    'requirements.txt',
    'requirements-dev.txt',
    'requirements-test.txt',
    'requirements_dev.txt',
    'requirements_test.txt',
    'Pipfile',
    'pytest.ini',
    'tox.ini',
  ];
  for (const name of candidates) {
    let raw: string;
    try {
      raw = await readFile(join(projectRoot, name), 'utf8');
    } catch {
      continue;
    }
    if (raw.includes('pytest')) return true;
  }
  return false;
}
