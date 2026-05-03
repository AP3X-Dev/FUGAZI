/**
 * coverage-setup/detect.ts — Phase 3h.6 (T215-T217) — runner detection.
 *
 * Read the project's `package.json` and identify which test runners are
 * present (`vitest`, `jest`, or `playwright`). The wizard surfaces a per-runner
 * config snippet (see `./snippets.ts`) so users can capture V8 coverage that
 * Fugazi's runtime layer consumes.
 *
 * Detection semantics: a runner is "detected" iff its package name appears in
 * `dependencies`, `devDependencies`, or `optionalDependencies`. Workspace
 * roots that aggregate multiple test runners therefore surface every match
 * (the wizard prints all of them).
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type SupportedRunner = 'vitest' | 'jest' | 'playwright';

export const SUPPORTED_RUNNERS: readonly SupportedRunner[] = ['vitest', 'jest', 'playwright'];

/** Verbatim error string used when no runner is detected. */
export const NO_RUNNER_MESSAGE =
  'coverage-setup: no supported test runner detected (looked for vitest, jest, playwright)';

export interface DetectRunnersOptions {
  readonly projectRoot: string;
}

/**
 * Detect which supported runners are listed in the project's package.json.
 * Returns the set of detected runners in canonical order
 * (`vitest`, `jest`, `playwright`).
 *
 * Returns an empty array on read or parse failure — the wizard treats that
 * the same as "none detected" (the verbatim error is emitted by the caller).
 */
export async function detectRunners(
  options: DetectRunnersOptions,
): Promise<readonly SupportedRunner[]> {
  const manifestPath = join(options.projectRoot, 'package.json');
  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch {
    return Object.freeze([]) as readonly SupportedRunner[];
  }
  let pkg: unknown;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return Object.freeze([]) as readonly SupportedRunner[];
  }
  if (pkg === null || typeof pkg !== 'object') {
    return Object.freeze([]) as readonly SupportedRunner[];
  }
  const merged = mergedDeps(pkg as Record<string, unknown>);
  const detected: SupportedRunner[] = [];
  for (const runner of SUPPORTED_RUNNERS) {
    if (merged.has(runner)) detected.push(runner);
  }
  return Object.freeze(detected) as readonly SupportedRunner[];
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
