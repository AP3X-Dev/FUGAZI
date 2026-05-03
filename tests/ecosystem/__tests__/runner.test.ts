/**
 * runner.test.ts — Phase 3k.5 — local smoke for the ecosystem runner.
 *
 * Asserts the projects.json shape and that the runner module exports the
 * expected functions. The actual clone+run sweep only fires in the weekly
 * cron CI job (or with SKIP_ECOSYSTEM=0 explicitly set); we never gate
 * `bun run test` on network access.
 */

import { describe, expect, it } from 'vitest';
import { loadProjects, runAll, runOne } from '../runner.js';

describe('ecosystem runner', () => {
  it('projects.json contains 12 entries with the required shape', async () => {
    const projects = await loadProjects();
    expect(projects.length).toBe(12);
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
    const projects = await loadProjects();
    const keys = new Set<string>();
    for (const p of projects) keys.add(`${p.org}/${p.repo}`);
    expect(keys.size).toBe(projects.length);
  });

  it('runner exports the public surface', () => {
    expect(typeof runOne).toBe('function');
    expect(typeof runAll).toBe('function');
  });

  it('skips actual network sweep without explicit opt-in', async () => {
    // The local test suite never opts in. The CI cron job sets
    // SKIP_ECOSYSTEM=0 to enable the real sweep.
    const opted = process.env.SKIP_ECOSYSTEM === '0';
    expect(opted).toBe(false);
  });
});
