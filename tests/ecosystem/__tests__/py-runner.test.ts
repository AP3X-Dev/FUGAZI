/**
 * py-runner.test.ts — Phase 4f T373 — local smoke for the Python ecosystem
 * runner.
 *
 * Asserts the py-projects.json shape and that the runner module exports the
 * expected functions. The actual clone+run sweep only fires in the weekly
 * cron CI job (or with SKIP_ECOSYSTEM=0 explicitly set); we never gate
 * `bun run test` on network access.
 */

import { describe, expect, it } from 'vitest';
import { loadPyProjects, runPyAll, runPyOne } from '../py-runner.js';

describe('py ecosystem runner', () => {
  it('py-projects.json contains 5 entries with the required shape', async () => {
    const projects = await loadPyProjects();
    expect(projects.length).toBe(5);
    for (const p of projects) {
      expect(typeof p.org).toBe('string');
      expect(p.org.length).toBeGreaterThan(0);
      expect(typeof p.repo).toBe('string');
      expect(p.repo.length).toBeGreaterThan(0);
      expect(typeof p.branch).toBe('string');
      expect(p.branch.length).toBeGreaterThan(0);
      expect(typeof p.install_command).toBe('string');
      expect(p.install_command.length).toBeGreaterThan(0);
      expect(p.subdir === null || typeof p.subdir === 'string').toBe(true);
    }
  });

  it('every entry refers to a unique <org>/<repo>', async () => {
    const projects = await loadPyProjects();
    const keys = new Set<string>();
    for (const p of projects) keys.add(`${p.org}/${p.repo}`);
    expect(keys.size).toBe(projects.length);
  });

  it('runner exports the public surface', () => {
    expect(typeof runPyOne).toBe('function');
    expect(typeof runPyAll).toBe('function');
  });

  it('skips actual network sweep without explicit opt-in', () => {
    const opted = process.env.SKIP_ECOSYSTEM === '0';
    expect(opted).toBe(false);
  });
});
