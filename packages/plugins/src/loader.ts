/**
 * loader.ts — bundled-plugin reader + external-plugin loader (Phase 3i Wave A).
 *
 *   - `loadBundledPlugins()` reads every `*.json` file under `src/data/` (or
 *     `dist/data/` post-build) and validates them against `PluginDefSchema`.
 *     The returned array is alphabetical by plugin `name` so consumer
 *     iteration order is deterministic across runs and across machines.
 *   - `loadExternalPlugin(absPath)` reads a single JSON/JSONC file from disk,
 *     validates it, and returns the parsed `PluginDef`.
 *   - `validatePlugin(unknown)` is the pure validator surface — used by both
 *     of the above and exposed for tests / external consumers.
 *
 * All filesystem reads are synchronous because plugin loading happens once
 * during `runAnalysis` startup and the JSON files are tiny (median ≈ 600
 * bytes). Synchronous reads keep the API non-async and free of microtask
 * scheduling.
 *
 * Cross-platform: the data directory is resolved via `import.meta.url` →
 * `fileURLToPath` so Windows paths work without manual normalisation. The
 * loader walks the directory non-recursively.
 *
 * Determinism (NFR-1): the bundled-plugin walker sorts entries by name
 * before validation. Map iteration is alphabetical. Re-load is idempotent.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ZodError } from 'zod';
import { PluginDefSchema } from './schema.js';
import type { PluginDef } from './types.js';

/**
 * Resolve the bundled data directory.
 *
 * When this module is loaded from `dist/loader.js`, the data lives at
 * `dist/data/` (post-build copy). When loaded from `src/loader.ts` (e.g.
 * during vitest or via direct Bun execution), the data lives next to the
 * source under `src/data/`. Both layouts are supported by checking for the
 * `data/` sibling first and falling back to `../src/data/`.
 */
function resolveDataDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const sibling = join(here, 'data');
  try {
    readdirSync(sibling);
    return sibling;
  } catch {
    // Fall through.
  }
  // Walk one level up — supports `dist/loader.js` resolving against
  // `src/data/` when no `dist/data/` exists.
  return join(here, '..', 'src', 'data');
}

/**
 * Validate an unknown value against the plugin schema. Returns a frozen
 * `PluginDef` on success. Errors fall through as `ZodError` for the caller
 * to handle.
 */
export function validatePlugin(input: unknown): PluginDef {
  const parsed = PluginDefSchema.parse(input);
  return Object.freeze(parsed);
}

/**
 * Try to validate; return `{ ok, plugin }` or `{ ok: false, error }`. Used
 * by `loadBundledPlugins` to skip malformed bundled plugins without crashing
 * the entire registry — a single bad data file should never fail-fast the
 * whole analysis (the loader logs to stderr instead).
 */
export interface ValidationResult {
  readonly ok: boolean;
  readonly plugin?: PluginDef;
  readonly error?: ZodError;
}

export function tryValidatePlugin(input: unknown): ValidationResult {
  const result = PluginDefSchema.safeParse(input);
  if (result.success) {
    return { ok: true, plugin: Object.freeze(result.data) };
  }
  return { ok: false, error: result.error };
}

/**
 * Read every bundled JSON plugin from `src/data/` (or `dist/data/`), validate
 * each, and return them sorted alphabetically by `name`.
 *
 * Skip-on-error policy: a single malformed JSON / failed schema validation
 * does NOT abort the whole load. The bad entry is dropped (silently in the
 * default loader; tests can inspect via `loadBundledPluginsVerbose`).
 *
 * Deterministic: the returned array is stable across runs given the same
 * data directory contents.
 */
export function loadBundledPlugins(): readonly PluginDef[] {
  const { plugins } = loadBundledPluginsVerbose();
  return plugins;
}

/**
 * Verbose variant — also returns the list of files that failed validation.
 * Useful for tests + the registry health check.
 */
export interface VerboseLoadResult {
  readonly plugins: readonly PluginDef[];
  readonly errors: readonly { readonly file: string; readonly error: ZodError | Error }[];
}

export function loadBundledPluginsVerbose(): VerboseLoadResult {
  const dataDir = resolveDataDir();
  let entries: readonly string[];
  try {
    entries = readdirSync(dataDir).filter((name) => name.endsWith('.json'));
  } catch {
    return { plugins: Object.freeze([]), errors: Object.freeze([]) };
  }

  // Sort by name BEFORE reading to keep error iteration deterministic too.
  const sorted = [...entries].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const plugins: PluginDef[] = [];
  const errors: { file: string; error: ZodError | Error }[] = [];

  for (const file of sorted) {
    const path = join(dataDir, file);
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (e) {
      errors.push({ file, error: e instanceof Error ? e : new Error(String(e)) });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      errors.push({ file, error: e instanceof Error ? e : new Error(String(e)) });
      continue;
    }
    const v = tryValidatePlugin(parsed);
    if (v.ok && v.plugin !== undefined) {
      plugins.push(v.plugin);
    } else if (v.error !== undefined) {
      errors.push({ file, error: v.error });
    }
  }

  // Final sort by plugin.name (alphabetical) for deterministic iteration.
  plugins.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return {
    plugins: Object.freeze(plugins),
    errors: Object.freeze(errors),
  };
}

/**
 * Load and validate a single external plugin from an absolute path. Used by
 * the config-driven `plugins.external[]` mechanism.
 *
 * Throws a plain `Error` with a verbatim message contract on read failure;
 * the caller is responsible for wrapping with FugaziError surface.
 */
export function loadExternalPlugin(absPath: string): PluginDef {
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf8');
  } catch (e) {
    throw new Error(`plugins: cannot read external plugin at ${absPath}: ${stringifyCause(e)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`plugins: invalid JSON in external plugin at ${absPath}: ${stringifyCause(e)}`);
  }
  try {
    return validatePlugin(parsed);
  } catch (e) {
    throw new Error(`plugins: schema validation failed for ${absPath}: ${stringifyCause(e)}`);
  }
}

function stringifyCause(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
