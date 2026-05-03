/**
 * detect.ts — plugin activation logic (Phase 3i Wave A).
 *
 * Two activation channels — `detection` (rich) and `enablers` (simple):
 *
 *   - When `detection` is set on a plugin, evaluate it recursively against
 *     the project. The result is the SOLE activation signal — `enablers` is
 *     ignored.
 *   - Otherwise fall back to `enablers`: a plugin is active when any enabler
 *     matches a name in the union of `dependencies` / `devDependencies` /
 *     `peerDependencies` from package.json. Prefix enablers ending in `/`
 *     match any package that starts with the prefix (e.g. `@storybook/`).
 *
 * Detection combinators:
 *
 *   - `dependency`  — one package name, exact match.
 *   - `fileExists`  — glob match against any project-relative file path. The
 *                     caller supplies the candidate file list. The detector
 *                     does NOT walk the filesystem itself — that would couple
 *                     plugin activation to discovery, which the driver runs
 *                     separately.
 *   - `all`         — every nested condition must be true (empty list is
 *                     trivially true, matching the "vacuous and" convention).
 *   - `any`         — at least one nested condition must be true (empty list
 *                     is trivially false).
 *
 * Pure, synchronous, never throws. Memoisation is the caller's job.
 *
 * Determinism (NFR-1): `detectActivePlugins` returns plugins in the same
 * order they appear in the input array. Callers that want alphabetical-by-
 * name ordering should pre-sort `plugins` (the bundled registry already does
 * this).
 */

import { matchesGlob } from './matcher.js';
import type { PluginDef, PluginDetection } from './types.js';

/**
 * The minimal package.json shape the detector reads. Avoids depending on
 * `@fugazi/config` for an interop-friendly surface — callers can pass any
 * object that has these three optional records.
 */
export interface PackageJsonForDetection {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

/**
 * The project surface the detector queries. `files` is a list of project-
 * relative POSIX paths used by `fileExists` detection. The driver builds
 * this from the discovery output and from the project root's top-level
 * directory listing.
 */
export interface DetectionContext {
  readonly pkg: PackageJsonForDetection;
  readonly files: readonly string[];
}

/**
 * Build the union dependency-name set from a package.json. Includes
 * dependencies, devDependencies, and peerDependencies. Returns a Set so
 * membership tests are O(1).
 */
export function collectDependencyNames(pkg: PackageJsonForDetection): ReadonlySet<string> {
  const out = new Set<string>();
  for (const key of Object.keys(pkg.dependencies ?? {})) out.add(key);
  for (const key of Object.keys(pkg.devDependencies ?? {})) out.add(key);
  for (const key of Object.keys(pkg.peerDependencies ?? {})) out.add(key);
  return out;
}

/**
 * Test whether an enabler matches the dependency set. An enabler ending in
 * `/` is a prefix match; otherwise an exact name match.
 */
export function matchesEnabler(enabler: string, deps: ReadonlySet<string>): boolean {
  if (enabler.endsWith('/')) {
    for (const name of deps) {
      if (name.startsWith(enabler)) return true;
    }
    return false;
  }
  return deps.has(enabler);
}

/**
 * Recursively evaluate a `PluginDetection` against the detection context.
 * Pure and synchronous.
 */
export function evaluateDetection(detection: PluginDetection, ctx: DetectionContext): boolean {
  switch (detection.type) {
    case 'dependency':
      return collectDependencyNames(ctx.pkg).has(detection.package);
    case 'fileExists':
      return ctx.files.some((file) => matchesGlob(detection.pattern, file));
    case 'all':
      return detection.conditions.every((c) => evaluateDetection(c, ctx));
    case 'any':
      return detection.conditions.some((c) => evaluateDetection(c, ctx));
  }
}

/**
 * Decide whether a single plugin is active. `detection` takes priority over
 * `enablers` per the schema contract.
 */
export function isPluginActive(plugin: PluginDef, ctx: DetectionContext): boolean {
  if (plugin.detection !== undefined) {
    return evaluateDetection(plugin.detection, ctx);
  }
  if (plugin.enablers.length === 0) return false;
  const deps = collectDependencyNames(ctx.pkg);
  for (const enabler of plugin.enablers) {
    if (matchesEnabler(enabler, deps)) return true;
  }
  return false;
}

/**
 * Filter the input plugin list to those active for this project. Order is
 * preserved from the input; callers that want alphabetical-by-name ordering
 * should pre-sort. The bundled registry returns sorted plugins by default.
 */
export function detectActivePlugins(
  plugins: readonly PluginDef[],
  ctx: DetectionContext,
): readonly PluginDef[] {
  const out: PluginDef[] = [];
  for (const plugin of plugins) {
    if (isPluginActive(plugin, ctx)) out.push(plugin);
  }
  return Object.freeze(out);
}
