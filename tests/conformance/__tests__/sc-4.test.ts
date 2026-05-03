/**
 * sc-4.test.ts — Phase 3m T284 — SC-4 acceptance row.
 *
 * SC-4 requires the 12-repo ecosystem regression to run without crashes,
 * exit ≤ 1, and finish within 60 s per project. The actual sweep runs
 * weekly via `.github/workflows/ecosystem.yml` (cron) or manual dispatch.
 *
 * This local SC-4 gate asserts the structural pre-conditions:
 *
 *   1. `tests/ecosystem/runner.ts` exists,
 *   2. `tests/ecosystem/projects.json` is well-formed and lists exactly 12
 *      entries with the expected schema (org, repo, branch, subdir,
 *      install_command),
 *   3. `.github/workflows/ecosystem.yml` exists and references both the
 *      cron schedule and `workflow_dispatch`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const ECOSYSTEM_DIR = resolve(REPO_ROOT, 'tests', 'ecosystem');
const RUNNER_PATH = resolve(ECOSYSTEM_DIR, 'runner.ts');
const PROJECTS_PATH = resolve(ECOSYSTEM_DIR, 'projects.json');
const WORKFLOW_PATH = resolve(REPO_ROOT, '.github', 'workflows', 'ecosystem.yml');

interface Project {
  readonly org: string;
  readonly repo: string;
  readonly branch: string;
  readonly subdir: string | null;
  readonly install_command: string;
}

describe('SC-4: 12-repo ecosystem regression', () => {
  it('the runner exists', () => {
    expect(existsSync(RUNNER_PATH)).toBe(true);
  });

  it('projects.json lists 12 entries with the expected schema', () => {
    expect(existsSync(PROJECTS_PATH)).toBe(true);
    const raw = readFileSync(PROJECTS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as readonly Project[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(12);
    for (const p of parsed) {
      expect(typeof p.org).toBe('string');
      expect(p.org.length).toBeGreaterThan(0);
      expect(typeof p.repo).toBe('string');
      expect(p.repo.length).toBeGreaterThan(0);
      expect(typeof p.branch).toBe('string');
      expect(p.branch.length).toBeGreaterThan(0);
      // subdir is `string | null`
      expect(p.subdir === null || typeof p.subdir === 'string').toBe(true);
      expect(typeof p.install_command).toBe('string');
      expect(p.install_command.length).toBeGreaterThan(0);
    }
  });

  it('the ecosystem GitHub Actions workflow is configured', () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
    const yaml = readFileSync(WORKFLOW_PATH, 'utf8');
    expect(yaml).toContain('cron:');
    expect(yaml).toContain('workflow_dispatch');
    // Reference the runner script entry point.
    expect(yaml).toContain('tests/ecosystem/runner.ts');
  });
});
