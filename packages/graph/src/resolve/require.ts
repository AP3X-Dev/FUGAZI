/**
 * require.ts — T087 / T088 — CommonJS `require()` resolver.
 *
 * `require()` resolution is a strict subset of static-import resolution:
 *
 *   - Relative specifiers go through the relative resolver.
 *   - Bare specifiers go through the node_modules walker.
 *   - Aliases are honored when an alias map is supplied.
 *
 * The CommonJS edge type is recorded by the caller; this module only owns
 * the dispatch.
 */

import { matchesAliasPrefix, resolveAlias } from './alias.js';
import type { FsAdapter } from './fs-adapter.js';
import { resolveNodeModules } from './node-modules.js';
import { resolveRelative } from './relative.js';
import { resolveTsconfigPaths } from './tsconfig-paths.js';

export interface RequireResolveOptions {
  readonly projectRoot: string;
  readonly aliases?: Readonly<Record<string, string>>;
  readonly conditions?: readonly string[];
  readonly tsconfigPaths?: {
    readonly baseUrl: string;
    readonly paths: ReadonlyMap<string, readonly string[]>;
  };
  readonly fs: FsAdapter;
}

/**
 * Resolve a `require()` argument the same way Node would. Returns the POSIX
 * file path or `null`.
 */
export function resolveRequire(
  specifier: string,
  fromFile: string,
  opts: RequireResolveOptions,
): string | null {
  if (specifier.startsWith('.')) {
    return resolveRelative(specifier, fromFile, opts.fs);
  }
  if (matchesAliasPrefix(specifier, opts.aliases)) {
    return resolveAlias(specifier, opts.projectRoot, opts.aliases, opts.fs);
  }
  if (opts.tsconfigPaths !== undefined) {
    const hit = resolveTsconfigPaths(specifier, fromFile, opts.fs, opts.tsconfigPaths);
    if (hit !== null) return hit;
  }
  return resolveNodeModules(specifier, fromFile, opts.conditions, opts.fs);
}
