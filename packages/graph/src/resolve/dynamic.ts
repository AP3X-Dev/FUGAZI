/**
 * dynamic.ts — T087 / T088 — dynamic `import()` resolver.
 *
 * Two shapes:
 *
 *   1. Concrete literal: `import('./foo')` — resolved exactly like a static
 *      import.
 *   2. Constant-prefix template: `import('./locales/' + locale + '.json')` —
 *      the prefix is a real path stem, but the suffix depends on a runtime
 *      value. We classify these as `kind: 'unresolvable'` because the
 *      single-file target cannot be determined statically.
 *
 * The classification result is what callers actually consume — they then
 * either feed it into the graph (resolved -> internal edge), record it as
 * an unresolved-but-real import (unresolvable), or surface it as an unknown
 * specifier.
 */

import { matchesAliasPrefix, resolveAlias } from './alias.js';
import type { FsAdapter } from './fs-adapter.js';
import { resolveNodeModules } from './node-modules.js';
import { resolveRelative } from './relative.js';
import { resolveTsconfigPaths } from './tsconfig-paths.js';

export type DynamicImportSpec =
  | { readonly kind: 'literal'; readonly source: string }
  | {
      readonly kind: 'template';
      /**
       * Prefix that is statically known. May be empty when the template
       * begins with a dynamic interpolation.
       */
      readonly prefix: string;
      /**
       * Suffix that is statically known. May be empty.
       */
      readonly suffix: string;
    };

export type DynamicResolution =
  | { readonly kind: 'resolved'; readonly target: string }
  | { readonly kind: 'unresolvable'; readonly source: string };

export interface DynamicResolveOptions {
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
 * Resolve a dynamic import. Returns either a concrete `resolved` target or
 * an `unresolvable` marker carrying the static prefix as the source.
 */
export function resolveDynamic(
  spec: DynamicImportSpec,
  fromFile: string,
  opts: DynamicResolveOptions,
): DynamicResolution {
  if (spec.kind === 'literal') {
    const target = resolveAsStatic(spec.source, fromFile, opts);
    if (target !== null) return { kind: 'resolved', target };
    return { kind: 'unresolvable', source: spec.source };
  }
  // Template: even when the prefix looks resolvable, the dynamic suffix
  // means we can't pin a single target. Surface the prefix so callers can
  // record glob-style intent.
  const summary = `${spec.prefix}*${spec.suffix}`;
  return { kind: 'unresolvable', source: summary };
}

function resolveAsStatic(
  source: string,
  fromFile: string,
  opts: DynamicResolveOptions,
): string | null {
  if (source.startsWith('.')) {
    return resolveRelative(source, fromFile, opts.fs);
  }
  if (matchesAliasPrefix(source, opts.aliases)) {
    return resolveAlias(source, opts.projectRoot, opts.aliases, opts.fs);
  }
  if (opts.tsconfigPaths !== undefined) {
    const hit = resolveTsconfigPaths(source, fromFile, opts.fs, opts.tsconfigPaths);
    if (hit !== null) return hit;
  }
  return resolveNodeModules(source, fromFile, opts.conditions, opts.fs);
}
