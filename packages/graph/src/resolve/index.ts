/**
 * resolve/index.ts — T089 / T090 — unified import-specifier resolver.
 *
 * The dispatcher orchestrates the four resolver strategies in this priority
 * order:
 *
 *   1. Relative specifiers (`.` / `..`)         -> resolveRelative
 *   2. Built-in or override aliases             -> resolveAlias
 *   3. tsconfig.json `paths` mappings           -> resolveTsconfigPaths
 *   4. Bare specifiers via node_modules walking -> resolveNodeModules
 *
 * Failures cascade: each step that returns `null` falls through to the next.
 * The final result is one of three shapes:
 *
 *   - `resolved`: a concrete POSIX path on disk.
 *   - `external`: a bare specifier that we recognized as a real module
 *     reference but did not find under any node_modules root. The consumer
 *     decides whether to record it as an unlisted dependency or ignore it.
 *   - `unresolved`: nothing matched and the specifier doesn't look like a
 *     bare module either (e.g. a path alias whose target doesn't exist).
 *
 * The function is synchronous and never throws. Inputs are not mutated.
 */

import { matchesAliasPrefix, resolveAlias } from './alias.js';
import { type FsAdapter, nodeFsAdapter } from './fs-adapter.js';
import { resolveNodeModules } from './node-modules.js';
import { resolveRelative } from './relative.js';
import { resolveTsconfigPaths } from './tsconfig-paths.js';

export type { FsAdapter } from './fs-adapter.js';
export { createMemoryFsAdapter, nodeFsAdapter } from './fs-adapter.js';
export { resolveRelative, RELATIVE_EXTENSIONS } from './relative.js';
export { resolveAlias, matchesAliasPrefix, DEFAULT_ALIASES } from './alias.js';
export {
  resolveTsconfigPaths,
  findNearestTsconfig,
  __clearTsconfigCacheForTest,
} from './tsconfig-paths.js';
export {
  resolveNodeModules,
  splitBareSpecifier,
  __clearPackageJsonCacheForTest,
} from './node-modules.js';
export { resolveExports, DEFAULT_CONDITIONS } from './exports-conditions.js';
export { resolveReactNative, DEFAULT_RN_PLATFORMS } from './react-native.js';
export { resolveRequire } from './require.js';
export {
  resolveDynamic,
  type DynamicImportSpec,
  type DynamicResolution,
} from './dynamic.js';
export { tryOutputToSourceFallback, tryWideIndexProbe } from './fallbacks.js';

export interface ResolverContext {
  /**
   * Absolute POSIX path to the project root. Used as the base for built-in
   * aliases like `~/foo` and `@/foo`.
   */
  readonly projectRoot: string;
  /**
   * Optional override for the built-in alias table. Keys must include the
   * trailing `/` (e.g. `'$lib/'`), values are paths relative to the project
   * root.
   */
  readonly aliases?: Readonly<Record<string, string>>;
  /**
   * Optional pre-parsed tsconfig.json `paths` table. When present, takes
   * precedence over filesystem-based discovery for hermetic test runs.
   */
  readonly tsconfigPaths?: {
    readonly baseUrl: string;
    readonly paths: ReadonlyMap<string, readonly string[]>;
  };
  /**
   * Active export condition order. Defaults to `DEFAULT_CONDITIONS`.
   */
  readonly conditions?: readonly string[];
  /**
   * React-native platform list. Currently consumed only by the react-native
   * variant resolver; the unified dispatcher does NOT auto-apply it.
   */
  readonly platforms?: readonly string[];
  /**
   * Filesystem adapter. Defaults to `nodeFsAdapter`.
   */
  readonly fs?: FsAdapter;
}

export type Resolution =
  | { readonly kind: 'resolved'; readonly target: string }
  | { readonly kind: 'external'; readonly source: string }
  | { readonly kind: 'unresolved'; readonly source: string };

/**
 * Resolve a single import specifier.
 *
 * Synchronous. Never throws. Same input always yields the same output.
 *
 * @param specifier  The raw import string from the AST.
 * @param fromFile   POSIX path of the importing file.
 * @param ctx        Resolver context. `fs` defaults to `nodeFsAdapter`.
 */
export function resolve(specifier: string, fromFile: string, ctx: ResolverContext): Resolution {
  const fs = ctx.fs ?? nodeFsAdapter;

  // 1. Relative.
  if (specifier.startsWith('.')) {
    const hit = resolveRelative(specifier, fromFile, fs);
    if (hit !== null) return { kind: 'resolved', target: hit };
    return { kind: 'unresolved', source: specifier };
  }

  // 2. Built-in / override alias.
  if (matchesAliasPrefix(specifier, ctx.aliases)) {
    const hit = resolveAlias(specifier, ctx.projectRoot, ctx.aliases, fs);
    if (hit !== null) return { kind: 'resolved', target: hit };
    return { kind: 'unresolved', source: specifier };
  }

  // 3. tsconfig paths (only when something is configured — hermetic mode
  //    via `ctx.tsconfigPaths`, or filesystem discovery otherwise).
  if (ctx.tsconfigPaths !== undefined) {
    const hit = resolveTsconfigPaths(specifier, fromFile, fs, ctx.tsconfigPaths);
    if (hit !== null) return { kind: 'resolved', target: hit };
  } else {
    const hit = resolveTsconfigPaths(specifier, fromFile, fs);
    if (hit !== null) return { kind: 'resolved', target: hit };
  }

  // 4. Bare specifier via node_modules.
  if (looksBare(specifier)) {
    const hit = resolveNodeModules(specifier, fromFile, ctx.conditions, fs);
    if (hit !== null) return { kind: 'resolved', target: hit };
    // Recognized as a real module name but absent on disk -> external.
    return { kind: 'external', source: specifier };
  }

  return { kind: 'unresolved', source: specifier };
}

/**
 * Cheap classification: a specifier is "bare" when it's neither relative
 * nor absolute and doesn't carry a URL scheme. Mirrors the original Fallow
 * Rust `is_bare_specifier`.
 */
function looksBare(specifier: string): boolean {
  if (specifier === '') return false;
  if (specifier.startsWith('.') || specifier.startsWith('/')) return false;
  if (specifier.includes('://')) return false;
  if (specifier.startsWith('data:')) return false;
  return true;
}
