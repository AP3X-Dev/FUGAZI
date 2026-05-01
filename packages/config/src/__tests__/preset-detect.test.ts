/**
 * preset-detect.test.ts — T040-test for the framework preset detector (T041).
 *
 * Verifies that `detectFrameworks(projectRoot)` reads `package.json`
 * (dependencies + devDependencies + peerDependencies + optionalDependencies)
 * and `tsconfig.json` (`compilerOptions.jsx`, `compilerOptions.types`),
 * maps each detected dep / signal to a framework family via a static lookup
 * table, and returns a sorted, deduplicated `readonly string[]`.
 *
 * Contract: this function never throws — every "unhappy" branch (missing
 * file, malformed JSON, missing directory) returns an empty list (or in the
 * case where only one of the two signals is malformed, the other still
 * contributes). Determinism: idempotent, sorted output.
 *
 * Spec refs: design-doc §3.4 frameworks, §4.D.1 plugins / framework presets.
 * PRP refs: FR-B3 (preset auto-detection), FR-D3 (deterministic emit).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectFrameworks } from '../preset-detect.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '..', '..', 'test', 'fixtures', 'preset-detect');

let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'fugazi-preset-detect-'));
});

afterAll(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

describe('detectFrameworks — package.json signals', () => {
  it('returns an empty list when package.json declares no deps', async () => {
    const result = await detectFrameworks(resolve(FIXTURES, 'empty-deps'));
    expect(result).toEqual([]);
  });

  it('detects react + vitest from a typical dependencies / devDependencies split', async () => {
    const result = await detectFrameworks(resolve(FIXTURES, 'react-vitest'));
    expect(result).toEqual(['react', 'vitest']);
  });

  it('detects next + react when both are present', async () => {
    const result = await detectFrameworks(resolve(FIXTURES, 'next-app'));
    expect(result).toEqual(['next', 'react']);
  });

  it('detects vue + vite from a Vue-on-Vite project', async () => {
    const result = await detectFrameworks(resolve(FIXTURES, 'vue-vite'));
    expect(result).toEqual(['vite', 'vue']);
  });

  it('detects svelte + sveltekit from a SvelteKit project', async () => {
    const result = await detectFrameworks(resolve(FIXTURES, 'svelte-kit'));
    expect(result).toEqual(['svelte', 'sveltekit']);
  });

  it('detects angular from a fresh Angular project', async () => {
    const result = await detectFrameworks(resolve(FIXTURES, 'angular'));
    expect(result).toEqual(['angular']);
  });

  it('detects astro from astro dep alone', async () => {
    const result = await detectFrameworks(resolve(FIXTURES, 'astro'));
    expect(result).toEqual(['astro']);
  });

  it('detects solid from solid-js', async () => {
    const result = await detectFrameworks(resolve(FIXTURES, 'solid'));
    expect(result).toEqual(['solid']);
  });

  it('detects qwik from @builder.io/qwik', async () => {
    const result = await detectFrameworks(resolve(FIXTURES, 'qwik'));
    expect(result).toEqual(['qwik']);
  });

  it('detects remix + react from a Remix project', async () => {
    const result = await detectFrameworks(resolve(FIXTURES, 'remix'));
    expect(result).toEqual(['react', 'remix']);
  });

  it('detects jest from jest devDependency', async () => {
    const result = await detectFrameworks(resolve(FIXTURES, 'jest-only'));
    expect(result).toEqual(['jest']);
  });

  it('reads peerDependencies and optionalDependencies', async () => {
    const result = await detectFrameworks(resolve(FIXTURES, 'peer-and-optional'));
    expect(result).toEqual(['angular', 'vitest']);
  });

  it('does not recurse into workspace package.json files', async () => {
    // The fixture declares `workspaces: ['packages/*']` and only top-level
    // `vitest`. We expect just the top-level signal.
    const result = await detectFrameworks(resolve(FIXTURES, 'with-workspaces'));
    expect(result).toEqual(['vitest']);
  });
});

describe('detectFrameworks — tsconfig.json signals', () => {
  it('detects react from `compilerOptions.jsx: "react-jsx"` alone', async () => {
    const result = await detectFrameworks(resolve(FIXTURES, 'tsconfig-only-react'));
    expect(result).toEqual(['react']);
  });

  it('detects vitest from `compilerOptions.types: ["vitest", "node"]`', async () => {
    const result = await detectFrameworks(resolve(FIXTURES, 'tsconfig-types-vitest'));
    expect(result).toEqual(['vitest']);
  });

  it('treats `compilerOptions.jsx: "preserve"` as ambiguous (no signal)', async () => {
    // jsx: 'preserve' is used by Vue, Svelte, and any setup that defers
    // JSX transform to a downstream tool. On its own, it does not pin a
    // framework, so the detector returns an empty list when no other
    // signals are present.
    const result = await detectFrameworks(resolve(FIXTURES, 'jsx-preserve'));
    expect(result).toEqual([]);
  });

  it('does not duplicate when both signals agree on react', async () => {
    const result = await detectFrameworks(resolve(FIXTURES, 'agreeing-signals'));
    expect(result).toEqual(['react']);
  });
});

describe('detectFrameworks — error tolerance', () => {
  it('returns an empty list when package.json is missing', async () => {
    const result = await detectFrameworks(resolve(FIXTURES, 'no-pkg-json'));
    expect(result).toEqual([]);
  });

  it('returns an empty list when the project directory does not exist', async () => {
    const missing = join(tmpRoot, 'definitely-not-a-real-dir');
    const result = await detectFrameworks(missing);
    expect(result).toEqual([]);
  });

  it('returns an empty list when package.json is malformed', async () => {
    const result = await detectFrameworks(resolve(FIXTURES, 'malformed-pkg'));
    expect(result).toEqual([]);
  });

  it('falls through a malformed tsconfig.json — package.json signal still works', async () => {
    const result = await detectFrameworks(resolve(FIXTURES, 'malformed-tsconfig'));
    expect(result).toEqual(['react']);
  });
});

describe('detectFrameworks — determinism (FR-D3)', () => {
  it('returns identical output across repeated invocations on the same root', async () => {
    const root = resolve(FIXTURES, 'react-vitest');
    const a = await detectFrameworks(root);
    const b = await detectFrameworks(root);
    const c = await detectFrameworks(root);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('returns a sorted list regardless of insertion order in package.json', async () => {
    // Build a dynamic package.json whose deps are intentionally inserted in
    // reverse-alphabetical order; the detector must still sort output.
    const root = await mkdtemp(join(tmpRoot, 'reverse-order-'));
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'reverse-order',
        dependencies: {
          vue: '^3.4.0',
          svelte: '^4.2.0',
          react: '^18.0.0',
          astro: '^4.0.0',
        },
      }),
      'utf8',
    );
    const result = await detectFrameworks(root);
    // Each dep maps to one family; the detector must emit them sorted.
    expect(result).toEqual(['astro', 'react', 'svelte', 'vue']);
    // Confirm the array is actually sorted (defensive).
    const sortedCopy = [...result].sort();
    expect(result).toEqual(sortedCopy);
  });
});
