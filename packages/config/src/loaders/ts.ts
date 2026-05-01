/**
 * loaders/ts.ts — TypeScript config loader (T035).
 *
 * Loads `fugazi.config.ts` (or any TS file path) by bundling and evaluating
 * the module via `bundle-require` (which uses esbuild under the hood). This
 * works on Node and on Bun, with no separate ts-node / tsx step.
 *
 * Returns the module's default export when present, otherwise the full
 * module namespace (so a config that uses named exports still surfaces
 * something the loader can hand off to the schema validator).
 *
 * Errors:
 *   - Any failure (file missing, parse error, evaluation throw) → wrapped in
 *     FugaziConfigError(code: 'CONFIG_PARSE_FAILED').
 *
 * Verbatim error string (per E5):
 *   - "Failed to load TS config at <path>"
 */
import { FugaziConfigError } from '@fugazi/types';
import { bundleRequire } from 'bundle-require';

interface MaybeDefaultExport {
  readonly default?: unknown;
}

/**
 * Load and evaluate a TypeScript config file. Returns the module's default
 * export when one is declared; otherwise returns the entire module namespace.
 */
export async function loadTsConfig(path: string): Promise<unknown> {
  let mod: unknown;
  try {
    const result = await bundleRequire({ filepath: path, format: 'esm' });
    mod = result.mod;
  } catch (cause) {
    throw new FugaziConfigError({
      code: 'CONFIG_PARSE_FAILED',
      message: `Failed to load TS config at ${path}`,
      ...(cause instanceof Error ? { cause } : {}),
    });
  }

  if (mod !== null && typeof mod === 'object' && 'default' in mod) {
    const def = (mod as MaybeDefaultExport).default;
    if (def !== undefined) return def;
  }
  return mod;
}
