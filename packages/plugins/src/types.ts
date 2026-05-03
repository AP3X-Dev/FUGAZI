/**
 * types.ts — declarative plugin type system (Phase 3i Wave A).
 *
 * Mirrors the canonical `plugin-schema.json` published by the upstream Fallow
 * project (MIT-licensed). All field shapes are deeply-readonly tuples of
 * primitives so the registry can freeze every loaded plugin at boot and
 * downstream consumers can pass plugins around with full type-safety and
 * zero defensive copies.
 *
 * camelCase is the canonical wire format. The JSON data files under `data/`
 * are emitted in camelCase by `tools/port-plugins.ts`.
 *
 * Determinism (NFR-1 / SC-15): plugin iteration order is alphabetical-by-name.
 * The loader sorts the bundled plugin map by `name` before returning. This
 * guarantees that two consumers loading the same JSON corpus see the same
 * order and produce byte-identical analysis output.
 *
 * AST-based config parsing (`resolve_config()` in the Rust source) is OUT OF
 * SCOPE for v1. Plugins ship the static `entryPoints` / `configPatterns` /
 * `alwaysUsed` / `usedExports` / `toolingDependencies` / `usedClassMembers`
 * fields. Dynamic config-file parsing may be added in a later phase via a
 * per-plugin `resolveConfig` callback.
 */

/**
 * `EntryPointRole` — coverage role for a plugin's discovered entry points.
 *
 *   - `runtime` — application roots that count toward runtime reachability.
 *   - `test`    — test-runner roots that count toward test reachability.
 *   - `support` — setup/config roots that keep files alive but do not count
 *                 as runtime/test reachability.
 *
 * Defaults to `support` when omitted.
 */
export type EntryPointRole = 'runtime' | 'test' | 'support';

/**
 * `PluginPackageManager` — which manifest the plugin's `enablers` apply to.
 *
 *   - `npm`    — package.json (dependencies / devDependencies / peerDependencies).
 *   - `pip`    — Python: pyproject.toml [project.dependencies], setup.cfg, requirements*.txt.
 *   - `poetry` — Python: pyproject.toml [tool.poetry.*].
 *   - `uv`     — Python: pyproject.toml [tool.uv.*] (best-effort).
 *   - `auto`   — default; both package.json AND any Python manifest are consulted.
 *
 * `pip` / `poetry` / `uv` all consult the same Python-manifest pipeline today
 * — the distinction is informational, not behavioural — but the field is
 * preserved so future per-resolver constraints can land without a schema bump.
 */
export type PluginPackageManager = 'npm' | 'pip' | 'poetry' | 'uv' | 'auto';

/**
 * `PluginDetection` — discriminated union over the four detection strategies
 * a plugin can use to decide whether it is active for a given project.
 *
 *   - `dependency`  — the named package appears in package.json deps/dev/peer.
 *   - `fileExists`  — a file matching the glob pattern exists under the root.
 *   - `all`         — every nested condition must be true.
 *   - `any`         — at least one nested condition must be true.
 *
 * Detection takes priority over `enablers` when set.
 */
export type PluginDetection =
  | { readonly type: 'dependency'; readonly package: string }
  | { readonly type: 'fileExists'; readonly pattern: string }
  | { readonly type: 'all'; readonly conditions: readonly PluginDetection[] }
  | { readonly type: 'any'; readonly conditions: readonly PluginDetection[] };

/**
 * `UsedExport` — exports that are always considered used for a file pattern.
 *
 *   - `pattern`  — glob over project-relative file paths.
 *   - `exports`  — export names always considered used for matching files.
 */
export interface UsedExport {
  readonly pattern: string;
  readonly exports: readonly string[];
}

/**
 * `ScopedUsedClassMember` — a heritage-constrained class-member rule.
 *
 *   - `extends`    — apply only when the class extends this parent name.
 *   - `implements` — apply only when the class implements this interface.
 *   - `members`    — member names treated as framework-used.
 *
 * Either or both of `extends` / `implements` may be present. When both are
 * absent, the rule is equivalent to a global string entry — the schema does
 * not enforce that, but the porter and registry treat it consistently.
 */
export interface ScopedUsedClassMember {
  readonly extends?: string;
  readonly implements?: string;
  readonly members: readonly string[];
}

/**
 * `UsedClassMember` — a single rule entry. Either a plain member name (string,
 * suppress globally for any class) or a scoped object with heritage filters.
 */
export type UsedClassMember = string | ScopedUsedClassMember;

/**
 * `PluginDef` — the full declarative plugin shape. Mirrors the
 * `ExternalPluginDef` schema from `plugin-schema.json` verbatim.
 *
 * Every list-typed field defaults to an empty list when omitted from the JSON
 * data file. The loader normalises missing fields to `Object.freeze([])` so
 * downstream consumers never see `undefined` lists.
 */
export interface PluginDef {
  readonly name: string;
  readonly detection?: PluginDetection;
  readonly enablers: readonly string[];
  readonly entryPoints: readonly string[];
  readonly entryPointRole: EntryPointRole;
  readonly configPatterns: readonly string[];
  readonly alwaysUsed: readonly string[];
  readonly toolingDependencies: readonly string[];
  readonly usedExports: readonly UsedExport[];
  readonly usedClassMembers: readonly UsedClassMember[];
  /**
   * Phase 4d T346. Which manifest the plugin's `enablers` apply to. Defaults
   * to `auto` (both package.json and pyproject.toml are checked). When
   * explicit, only the named manager's manifest is consulted by the
   * detection layer. Backwards-compatible: bundled TS plugins that do not
   * set this field continue to be evaluated against package.json (since
   * `auto` checks both, but no Python manifest will ever contain a TS
   * package name).
   */
  readonly packageManager: PluginPackageManager;
  /**
   * Phase 4d T346. Decorator names (dotted-form, matching the visitor's
   * `Usage{kind:'decorator'}.name` payload) that mark a class member as
   * framework-used. Examples: `'app.route'`, `'pytest.fixture'`. Bare names
   * (`'fixture'`) match both `@fixture` and `@pytest.fixture`. Empty by
   * default. The `unused-class-members` rule reads the union of this list
   * across active plugins and exempts members carrying any allowlisted
   * decorator.
   */
  readonly usedDecorators: readonly string[];
}
