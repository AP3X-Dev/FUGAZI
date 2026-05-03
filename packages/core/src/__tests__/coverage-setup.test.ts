/**
 * coverage-setup.test.ts — Phase 3h.6 (T215-T217) — runner detection +
 * snippet emission.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NO_RUNNER_MESSAGE, SUPPORTED_RUNNERS, detectRunners } from '../coverage-setup/detect.js';
import { buildSnippets } from '../coverage-setup/snippets.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fugazi-cov-test-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeManifest(deps: Readonly<Record<string, string>>): Promise<void> {
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', devDependencies: deps }),
    'utf8',
  );
}

describe('detectRunners', () => {
  it('detects vitest in devDependencies', async () => {
    await writeManifest({ vitest: '^2.0.0' });
    const detected = await detectRunners({ projectRoot: root });
    expect(detected).toEqual(['vitest']);
  });

  it('detects jest', async () => {
    await writeManifest({ jest: '^29.0.0' });
    const detected = await detectRunners({ projectRoot: root });
    expect(detected).toEqual(['jest']);
  });

  it('detects playwright', async () => {
    await writeManifest({ playwright: '^1.0.0' });
    const detected = await detectRunners({ projectRoot: root });
    expect(detected).toEqual(['playwright']);
  });

  it('detects multiple runners in canonical order', async () => {
    await writeManifest({ jest: '^29.0.0', vitest: '^2.0.0', playwright: '^1.0.0' });
    const detected = await detectRunners({ projectRoot: root });
    expect(detected).toEqual(['vitest', 'jest', 'playwright']);
  });

  it('returns empty when no runner is detected', async () => {
    await writeManifest({ typescript: '^5.0.0' });
    const detected = await detectRunners({ projectRoot: root });
    expect(detected).toEqual([]);
  });

  it('returns empty on missing package.json', async () => {
    const detected = await detectRunners({ projectRoot: root });
    expect(detected).toEqual([]);
  });

  it('returns empty on malformed package.json', async () => {
    await writeFile(join(root, 'package.json'), 'not-json', 'utf8');
    const detected = await detectRunners({ projectRoot: root });
    expect(detected).toEqual([]);
  });

  it('SUPPORTED_RUNNERS is the canonical [vitest, jest, playwright, pytest]', () => {
    expect(SUPPORTED_RUNNERS).toEqual(['vitest', 'jest', 'playwright', 'pytest']);
  });
});

describe('NO_RUNNER_MESSAGE', () => {
  it('matches the verbatim contract', () => {
    expect(NO_RUNNER_MESSAGE).toBe(
      'coverage-setup: no supported test runner detected (looked for vitest, jest, playwright, pytest)',
    );
  });
});

describe('detectRunners — Python (Phase 4e T366)', () => {
  it('detects pytest in pyproject.toml', async () => {
    await writeFile(
      join(root, 'pyproject.toml'),
      '[project]\nname = "x"\n[tool.pytest.ini_options]\naddopts = "--strict-markers"\n',
      'utf8',
    );
    const detected = await detectRunners({ projectRoot: root });
    expect(detected).toEqual(['pytest']);
  });

  it('detects pytest in requirements.txt', async () => {
    await writeFile(join(root, 'requirements.txt'), 'pytest==8.0.0\n', 'utf8');
    const detected = await detectRunners({ projectRoot: root });
    expect(detected).toEqual(['pytest']);
  });

  it('detects pytest in setup.cfg', async () => {
    await writeFile(join(root, 'setup.cfg'), '[options.extras_require]\ntest = pytest\n', 'utf8');
    const detected = await detectRunners({ projectRoot: root });
    expect(detected).toEqual(['pytest']);
  });

  it('mixed monorepo surfaces vitest + pytest in canonical order', async () => {
    await writeManifest({ vitest: '^2.0.0' });
    await writeFile(join(root, 'pyproject.toml'), 'dependencies = ["pytest"]\n', 'utf8');
    const detected = await detectRunners({ projectRoot: root });
    expect(detected).toEqual(['vitest', 'pytest']);
  });

  it('does not detect pytest when manifest exists but text is absent', async () => {
    await writeFile(join(root, 'pyproject.toml'), '[project]\nname = "x"\n', 'utf8');
    const detected = await detectRunners({ projectRoot: root });
    expect(detected).toEqual([]);
  });

  it('emits a pytest snippet pointing at pyproject.toml', () => {
    const snippets = buildSnippets(root, ['pytest']);
    expect(snippets[0]?.runner).toBe('pytest');
    expect(snippets[0]?.configPath).toBe(join(root, 'pyproject.toml'));
    expect(snippets[0]?.snippet).toContain('pytest --cov');
    expect(snippets[0]?.snippet).toContain('coverage.json');
  });
});

describe('buildSnippets', () => {
  it('emits a vitest snippet that mentions the v8 provider', () => {
    const snippets = buildSnippets(root, ['vitest']);
    expect(snippets).toHaveLength(1);
    expect(snippets[0]?.runner).toBe('vitest');
    expect(snippets[0]?.snippet).toContain("provider: 'v8'");
    expect(snippets[0]?.snippet).toContain("reporter: ['json']");
    expect(snippets[0]?.configPath).toBe(join(root, 'vitest.config.ts'));
  });

  it('emits a jest snippet', () => {
    const snippets = buildSnippets(root, ['jest']);
    expect(snippets[0]?.snippet).toContain("coverageProvider: 'v8'");
    expect(snippets[0]?.configPath).toBe(join(root, 'jest.config.js'));
  });

  it('emits a playwright snippet', () => {
    const snippets = buildSnippets(root, ['playwright']);
    expect(snippets[0]?.snippet).toContain('Profiler.takePreciseCoverage');
    expect(snippets[0]?.configPath).toBe(join(root, 'playwright.config.ts'));
  });

  it('emits one snippet per detected runner', () => {
    const snippets = buildSnippets(root, ['vitest', 'jest', 'playwright']);
    expect(snippets).toHaveLength(3);
    expect(snippets.map((s) => s.runner)).toEqual(['vitest', 'jest', 'playwright']);
  });
});
