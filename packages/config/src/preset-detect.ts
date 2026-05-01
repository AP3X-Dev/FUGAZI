/**
 * preset-detect.ts — T041 framework preset detector.
 *
 * Inspects a project root for signals that identify which framework
 * families a TS/JS project uses (react, vue, svelte, next, vitest, jest,
 * etc.). The detected families are the input to plugin loading later in
 * Phase 3i — this module only emits the *names* of the families that
 * apply, not the plugin manifests themselves.
 *
 * Signals (in priority order):
 *   1. `<root>/package.json` — `dependencies`, `devDependencies`,
 *      `peerDependencies`, `optionalDependencies`. Each dep name is looked
 *      up in `DEP_TO_FAMILY` and the corresponding family is added.
 *   2. `<root>/tsconfig.json` — `compilerOptions.jsx`
 *      (`'react'` / `'react-jsx'` / `'react-jsxdev'` → `react`) and
 *      `compilerOptions.types` entries are looked up in the same table.
 *      `jsx: 'preserve'` is intentionally ambiguous (Vue, Svelte, or any
 *      tool that defers JSX transform downstream) and contributes nothing
 *      on its own.
 *
 * The result is a sorted, deduplicated `readonly string[]`. The function
 * never throws — every error condition (missing file, malformed JSON,
 * missing directory) yields an empty contribution from that signal so
 * the other signal can still produce a useful result.
 *
 * Spec refs: design-doc §3.4 frameworks, §4.D.1 plugins / framework
 * presets. PRP refs: FR-B3 (preset auto-detection), FR-D3 (deterministic
 * emit).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';

/**
 * Static lookup: package-name → framework-family identifier. The full
 * 91-plugin family-specific behavior comes in Phase 3i; this table is
 * only used to identify *which* families are in play for a given project.
 *
 * Keep names in canonical lower-kebab/scope form. Values are stable
 * identifiers consumed by downstream plugin loading.
 */
const DEP_TO_FAMILY: Readonly<Record<string, string>> = {
  // React family
  react: 'react',
  'react-dom': 'react',
  '@types/react': 'react',
  // Next
  next: 'next',
  // Nuxt
  nuxt: 'nuxt',
  '@nuxt/kit': 'nuxt',
  // Vue
  vue: 'vue',
  '@vue/compiler-sfc': 'vue',
  '@vitejs/plugin-vue': 'vue',
  // Svelte
  svelte: 'svelte',
  '@sveltejs/kit': 'sveltekit',
  '@sveltejs/vite-plugin-svelte': 'svelte',
  // Angular
  '@angular/core': 'angular',
  '@angular/cli': 'angular',
  // Astro
  astro: 'astro',
  // Solid
  'solid-js': 'solid',
  // Qwik
  '@builder.io/qwik': 'qwik',
  // Remix
  '@remix-run/react': 'remix',
  '@remix-run/node': 'remix',
  // Test runners
  vitest: 'vitest',
  jest: 'jest',
  '@playwright/test': 'playwright',
  '@testing-library/react': 'react',
  '@testing-library/vue': 'vue',
  // Build tools (signal only)
  vite: 'vite',
  rollup: 'rollup',
  webpack: 'webpack',
  esbuild: 'esbuild',
  turbopack: 'turbopack',
  // Frameworks of frameworks
  expo: 'expo',
  'react-native': 'react-native',
  // Mobile
  '@ionic/react': 'ionic',
  '@ionic/vue': 'ionic',
  // Storybook
  storybook: 'storybook',
  '@storybook/react': 'storybook',
  '@storybook/vue3': 'storybook',
  // Misc backend / app frameworks
  '@fastify/core': 'fastify',
  express: 'express',
  koa: 'koa',
  hono: 'hono',
};

/** Section keys in `package.json` that contribute dependency names. */
const DEP_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/**
 * Detect the set of framework families the project at `projectRoot`
 * uses. The returned list is deduplicated, sorted, and deterministic
 * across repeated invocations on the same input.
 *
 * Never throws — error conditions (no `package.json`, malformed JSON,
 * missing directory) collapse to an empty contribution from the
 * affected signal.
 */
export async function detectFrameworks(projectRoot: string): Promise<readonly string[]> {
  const detected = new Set<string>();

  // 1. package.json — primary signal.
  const pkg = await tryReadJson(join(projectRoot, 'package.json'));
  if (isPlainObject(pkg)) {
    for (const section of DEP_SECTIONS) {
      const deps = pkg[section];
      if (!isPlainObject(deps)) continue;
      for (const depName of Object.keys(deps)) {
        const family = DEP_TO_FAMILY[depName];
        if (family !== undefined) detected.add(family);
      }
    }
  }

  // 2. tsconfig.json — secondary signal. Only contributes additional
  //    families; never overrides what package.json already established.
  const tsconfig = await tryReadJson(join(projectRoot, 'tsconfig.json'));
  if (isPlainObject(tsconfig)) {
    const compilerOptions = tsconfig.compilerOptions;
    if (isPlainObject(compilerOptions)) {
      const jsx = compilerOptions.jsx;
      if (jsx === 'react' || jsx === 'react-jsx' || jsx === 'react-jsxdev') {
        detected.add('react');
      }
      // jsx === 'preserve' is intentionally ambiguous — no contribution.

      const types = compilerOptions.types;
      if (Array.isArray(types)) {
        for (const t of types) {
          if (typeof t !== 'string') continue;
          const family = DEP_TO_FAMILY[t];
          if (family !== undefined) detected.add(family);
        }
      }
    }
  }

  return [...detected].sort();
}

/**
 * Read a JSON / JSONC file and return its parsed value, or `undefined`
 * if the file is missing, unreadable, or malformed. The detector swallows
 * all errors here intentionally (see contract in module header).
 */
async function tryReadJson(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return undefined;
  }

  // Strip a UTF-8 BOM if present (parity with the JSON loader).
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  // jsonc-parser tolerates comments and trailing commas; on hard parse
  // failure it returns `undefined` and reports via the errors array. We
  // treat any reported error as "malformed" → undefined.
  const errors: { error: number; offset: number; length: number }[] = [];
  const parsed: unknown = parseJsonc(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) return undefined;
  return parsed;
}

/** Type guard for plain (non-array, non-null) objects. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
