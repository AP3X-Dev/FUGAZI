/**
 * fixture-runner.ts — Phase 3k shared runner for project + conformance fixtures.
 *
 * Each fixture is a directory containing a package.json, a tsconfig.json, and a
 * src/ tree. The runner invokes `runAnalysis` against the fixture root and
 * returns a normalised payload (issues + actions + activePlugins + the
 * deterministic shape of `_meta`) suitable for byte-equal assertion against an
 * `expected.json` snapshot.
 *
 * Determinism contract (NFR-1 / SC-15): two consecutive calls over the same
 * fixture must produce byte-equal `normalize(result)` payloads. The non-
 * deterministic fields (`metrics.elapsedMs`, the WASM-parser-version-derived
 * `_meta.determinismHash`, progress sequencing) are stripped before
 * comparison.
 *
 * The runner is read-only: it does not mutate the fixture tree or write files
 * inside it. Tests call `freezeFixture(dir)` once per fixture to load + sort
 * its `expected.json`; tests that lack one can call `runFixture(dir)` directly
 * and compare against an inline literal.
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import type { FugaziConfig } from '@fugazi/config';
import { runAnalysis } from '@fugazi/core';
import type { RunAnalysisResult } from '@fugazi/core';

/**
 * Default `FugaziConfig` used by every fixture. Identical to the one driving
 * the core `run-analysis.test.ts` happy paths; matches the schema's defaults
 * minus `entrypoints` which fixtures supply per-test when needed.
 */
export function defaultFixtureConfig(overrides: Partial<FugaziConfig> = {}): FugaziConfig {
  return {
    rules: {},
    include: ['**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}'],
    exclude: ['node_modules', 'dist', 'build', 'coverage'],
    production: false,
    strict: false,
    experimentalTsPlugins: false,
    ...overrides,
  } as FugaziConfig;
}

/**
 * Convert a Windows backslash path to POSIX so byte-equality assertions don't
 * fork per platform. `runAnalysis` itself already POSIX-normalises issue
 * paths; this helper covers the few caller-side joins.
 */
export function toPosix(p: string): string {
  return sep === '\\' ? p.replaceAll('\\', '/') : p;
}

/**
 * Strip the absolute project root from every issue/action so the payload is
 * portable across machines. Re-key issues by relative path. Strips
 * `metrics.elapsedMs` and `_meta.determinismHash` (the latter depends on
 * absolute paths through issue.file, so it would diverge). Progress events
 * are stripped entirely — they're a separate contract verified by
 * `run-analysis.test.ts` and not part of the fixture freeze.
 */
export function normalizeForFreeze(result: RunAnalysisResult, projectRoot: string): unknown {
  const rootPosix = toPosix(projectRoot).replace(/\/$/, '');
  const rel = (p: string): string => {
    const posix = toPosix(p);
    if (posix.startsWith(`${rootPosix}/`)) {
      return posix.slice(rootPosix.length + 1);
    }
    if (posix === rootPosix) return '';
    return posix;
  };

  // Verbatim error messages can embed absolute paths (e.g. unresolved-imports:
  // "cannot resolve X from <abs/path>"). The freeze must be portable across
  // machines so we substitute the project root with `<root>` inside every
  // message string before serialising.
  const messageRebase = (msg: string): string => {
    if (rootPosix.length === 0) return msg;
    // Replace both POSIX and platform paths defensively.
    let out = msg.split(rootPosix).join('<root>');
    if (sep === '\\') {
      const win = projectRoot.replace(/\//g, '\\');
      out = out.split(win).join('<root>');
    }
    return out;
  };

  const issues = result.issues.map((issue) => {
    const out: Record<string, unknown> = { ...issue };
    out.file = rel(issue.file);
    out.message = messageRebase(issue.message);
    if ('path' in issue && typeof issue.path === 'string') {
      out.path = rel(issue.path);
    }
    if ('manifestPath' in issue && typeof issue.manifestPath === 'string') {
      out.manifestPath = rel(issue.manifestPath);
    }
    if ('cycle' in issue && Array.isArray(issue.cycle)) {
      out.cycle = (issue.cycle as readonly string[]).map((p) => rel(p));
    }
    if ('from' in issue && typeof issue.from === 'string') {
      out.from = rel(issue.from);
    }
    if ('to' in issue && typeof issue.to === 'string') {
      out.to = rel(issue.to);
    }
    if ('occurrences' in issue && Array.isArray((issue as { occurrences?: unknown }).occurrences)) {
      const occ = (issue as { occurrences: readonly { file: string; range: unknown }[] })
        .occurrences;
      out.occurrences = occ.map((o) => ({ ...o, file: rel(o.file) }));
    }
    return out;
  });

  const actions = result.actions.map((action) => {
    const diag = { ...action.diagnostic } as Record<string, unknown>;
    diag.file = rel(action.diagnostic.file);
    return {
      kind: action.kind,
      diagnostic: diag,
      description: action.description,
      edits: action.edits.map((e) => ({ ...e, file: rel(e.file) })),
    };
  });

  const activePlugins = result.activePlugins === undefined ? undefined : [...result.activePlugins];

  return {
    issues,
    actions,
    activePlugins,
    metrics: {
      filesScanned: result.metrics.filesScanned,
      diagnosticsByRule: result.metrics.diagnosticsByRule,
      cacheHitRate: result.metrics.cacheHitRate,
    },
    _meta: {
      version: result._meta.version,
      mode: result._meta.mode,
    },
  };
}

/**
 * Read an optional `fugazi.fixture.json` colocated with the fixture. The file
 * lets a fixture pin its own entrypoints / zones / rule overrides without
 * forcing the runner to ship a hardcoded table per fixture name.
 */
async function loadFixtureConfig(fixtureDir: string): Promise<Partial<FugaziConfig>> {
  const path = join(fixtureDir, 'fugazi.fixture.json');
  if (!existsSync(path)) return {};
  const raw = await readFile(path, 'utf8');
  try {
    return JSON.parse(raw) as Partial<FugaziConfig>;
  } catch (err) {
    throw new Error(
      `fixture-runner: malformed fugazi.fixture.json at "${path}": ${(err as Error).message}`,
    );
  }
}

/**
 * Run the analyzer against a fixture directory and return the normalised
 * payload. The fixture must contain at minimum a `package.json` (so plugin
 * activation has a manifest to read).
 */
export async function runFixture(
  fixtureDir: string,
  options: { config?: Partial<FugaziConfig>; mode?: 'full' | 'audit' } = {},
): Promise<{ payload: unknown; result: RunAnalysisResult }> {
  if (!isAbsolute(fixtureDir)) {
    throw new Error(`runFixture: fixtureDir must be absolute, got "${fixtureDir}"`);
  }
  const fileConfig = await loadFixtureConfig(fixtureDir);
  const merged = { ...fileConfig, ...(options.config ?? {}) };
  const result = await runAnalysis({
    kind: options.mode ?? 'full',
    config: defaultFixtureConfig(merged),
    projectRoot: resolve(fixtureDir),
  });
  const payload = normalizeForFreeze(result, fixtureDir);
  return { payload, result };
}

/**
 * Sort keys of an arbitrary JSON value recursively. Object keys go in
 * lexicographic order so two semantically-equal payloads serialise byte-equal
 * regardless of insertion order.
 */
function canonicalSortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalSortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = canonicalSortKeys(v);
    return out;
  }
  return value;
}

/**
 * Canonical JSON: sorted-keys + 2-space indented + trailing LF. Used by both
 * the assertion side and the freeze-write side.
 */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalSortKeys(value), null, 2)}\n`;
}

/**
 * Compare a fixture's actual payload against its `expected.json`. If the file
 * does not exist (first run) AND `FUGAZI_FREEZE=1` is set, write the file and
 * return `{ status: 'frozen' }`. Otherwise the missing file is a hard error.
 */
export async function freezeFixture(
  fixtureDir: string,
  options: { config?: Partial<FugaziConfig>; mode?: 'full' | 'audit' } = {},
): Promise<{
  status: 'matched' | 'frozen';
  expectedPath: string;
  actual: string;
  expected: string;
}> {
  const expectedPath = join(fixtureDir, 'expected.json');
  const { payload } = await runFixture(fixtureDir, options);
  const actual = canonicalJson(payload);

  if (!existsSync(expectedPath)) {
    if (process.env.FUGAZI_FREEZE === '1') {
      await writeFile(expectedPath, actual, 'utf8');
      return { status: 'frozen', expectedPath, actual, expected: actual };
    }
    throw new Error(
      `expected.json not found for fixture "${fixtureDir}" — set FUGAZI_FREEZE=1 to record the first run`,
    );
  }

  const expected = await readFile(expectedPath, 'utf8');
  return { status: 'matched', expectedPath, actual, expected };
}
