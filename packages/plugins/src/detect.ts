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
import type { PluginDef, PluginDetection, PluginPackageManager } from './types.js';

/**
 * PEP 503 normalize a package name. Lowercase, collapse runs of `[._-]+` to
 * a single `-`. Local copy to avoid a cross-package import on `@fugazi/graph`
 * which would create a layer-violation cycle (graph already depends on
 * plugins indirectly via core).
 */
function pep503Normalize(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[-_.]+/g, '-');
}

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
 * Phase 4d T347. The minimal Python-manifest shape the detector reads.
 * Mirrors the shape produced by `loadPythonManifest()` in `@fugazi/graph`
 * but without depending on it directly — callers pass either the live
 * manifest's runtime/dev sets or a constructed surface.
 *
 * Names in `runtime` / `dev` MUST be PEP 503-normalized (lowercase, with
 * runs of `[._-]+` collapsed to a single hyphen). The detector does NOT
 * re-normalize, so callers that pass raw enabler strings should normalize
 * them upstream when constructing the context.
 */
export interface PythonManifestForDetection {
  readonly runtime: ReadonlySet<string>;
  readonly dev: ReadonlySet<string>;
}

/**
 * The project surface the detector queries. `files` is a list of project-
 * relative POSIX paths used by `fileExists` detection. The driver builds
 * this from the discovery output and from the project root's top-level
 * directory listing.
 *
 * `pyManifest` (Phase 4d T347) is optional — when absent, all Python-only
 * plugins (those with `packageManager: 'pip' | 'poetry' | 'uv'`) silently
 * fail to activate. `auto` plugins fall back to package.json alone.
 */
export interface DetectionContext {
  readonly pkg: PackageJsonForDetection;
  readonly files: readonly string[];
  readonly pyManifest?: PythonManifestForDetection;
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
 * Build the union dependency-name set from a Python manifest. Returns a
 * single set unioning `runtime ∪ dev` so membership tests are O(1). All
 * names are presumed PEP 503 normalized by the manifest loader; the detector
 * normalizes its enabler at lookup time so callers can ship either form.
 */
export function collectPythonDependencyNames(
  manifest: PythonManifestForDetection,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const name of manifest.runtime) out.add(name);
  for (const name of manifest.dev) out.add(name);
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
 * Phase 4d T347. PEP 503-aware enabler match. The enabler is normalized
 * before lookup so plugin authors can ship `SQLAlchemy`, `sqlalchemy`, or
 * `tortoise-orm` interchangeably and get the same activation behaviour.
 */
export function matchesPythonEnabler(enabler: string, deps: ReadonlySet<string>): boolean {
  const normalized = pep503Normalize(enabler);
  if (normalized.endsWith('/')) {
    // Prefix-match form is rare for Python; preserved for symmetry.
    for (const name of deps) {
      if (name.startsWith(normalized)) return true;
    }
    return false;
  }
  return deps.has(normalized);
}

/**
 * Phase 4d T347. Decide which manifest pipelines to consult for an enabler
 * lookup, based on the plugin's `packageManager` field.
 *
 *   - `auto` (default): check BOTH package.json and any Python manifest.
 *   - `npm`:            only package.json.
 *   - `pip` / `poetry` / `uv`: only Python manifest.
 */
function enablerMatchesAny(
  enabler: string,
  packageManager: PluginPackageManager,
  ctx: DetectionContext,
): boolean {
  const checkNpm = packageManager === 'auto' || packageManager === 'npm';
  const checkPy =
    packageManager === 'auto' ||
    packageManager === 'pip' ||
    packageManager === 'poetry' ||
    packageManager === 'uv';

  if (checkNpm) {
    const npmDeps = collectDependencyNames(ctx.pkg);
    if (matchesEnabler(enabler, npmDeps)) return true;
  }
  if (checkPy && ctx.pyManifest !== undefined) {
    const pyDeps = collectPythonDependencyNames(ctx.pyManifest);
    if (matchesPythonEnabler(enabler, pyDeps)) return true;
  }
  return false;
}

/**
 * Recursively evaluate a `PluginDetection` against the detection context.
 * Pure and synchronous.
 *
 * Phase 4d T347: the `dependency` rule consults BOTH package.json and any
 * Python manifest by default. Plugins that need to scope to a single
 * pipeline express that via the parent plugin's `packageManager` field; the
 * detection sub-tree is run with that context unchanged. We do NOT thread
 * `packageManager` into the recursion because the schema only attaches it
 * to the plugin root, not per-condition.
 */
export function evaluateDetection(detection: PluginDetection, ctx: DetectionContext): boolean {
  switch (detection.type) {
    case 'dependency': {
      // Auto-mode dependency match: union of npm + python.
      const npmDeps = collectDependencyNames(ctx.pkg);
      if (npmDeps.has(detection.package)) return true;
      if (ctx.pyManifest !== undefined) {
        const pyDeps = collectPythonDependencyNames(ctx.pyManifest);
        if (matchesPythonEnabler(detection.package, pyDeps)) return true;
      }
      return false;
    }
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
 * `enablers` per the schema contract. When falling back to `enablers`, the
 * plugin's `packageManager` field decides which manifest pipeline(s) to
 * consult — `auto` (default) checks both, `npm` only package.json, and
 * `pip` / `poetry` / `uv` only the Python manifest.
 */
export function isPluginActive(plugin: PluginDef, ctx: DetectionContext): boolean {
  if (plugin.detection !== undefined) {
    return evaluateDetection(plugin.detection, ctx);
  }
  if (plugin.enablers.length === 0) return false;
  const packageManager = plugin.packageManager;
  for (const enabler of plugin.enablers) {
    if (enablerMatchesAny(enabler, packageManager, ctx)) return true;
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
