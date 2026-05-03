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
  | { readonly kind: 'builtin'; readonly source: string }
  | { readonly kind: 'unresolved'; readonly source: string };

/**
 * Runtime-builtin specifier prefixes. Imports of `node:fs`, `node:path`, etc.
 * are Node's built-in modules; `bun:test`, `bun:sqlite`, etc. are Bun's
 * built-ins. Neither resolves on disk and neither is a third-party package,
 * so flagging them as `unresolved` or `external` produces false-positive
 * `unresolved-imports` / `unlisted-dependencies` findings.
 *
 * The dispatcher short-circuits these to a dedicated `builtin` Resolution
 * kind. The graph layer treats `builtin` like `external` but with the edge
 * marked `resolvable: true` so rules don't fire.
 */
const RUNTIME_BUILTIN_PREFIXES: readonly string[] = Object.freeze(['node:', 'bun:']);

function isRuntimeBuiltin(specifier: string): boolean {
  for (const prefix of RUNTIME_BUILTIN_PREFIXES) {
    if (specifier.startsWith(prefix)) return true;
  }
  return false;
}

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

  // 0. Runtime builtins (`node:fs`, `bun:test`, …). These never resolve on
  //    disk and are not user-facing dependencies — short-circuit before any
  //    other strategy so they don't fall through to `resolveNodeModules` and
  //    surface as false-positive unresolved/unlisted findings.
  if (isRuntimeBuiltin(specifier)) {
    return { kind: 'builtin', source: specifier };
  }

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
