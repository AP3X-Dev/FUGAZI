/**
 * registry.ts — bundled plugin registry (Phase 3i Wave A).
 *
 *   - `BUILTIN_PLUGINS` is a frozen, alphabetical-by-name list of every
 *     bundled plugin under `src/data/`. Lazily loaded the first time it is
 *     accessed so importing this module is free.
 *   - `getPlugin(name)` looks up a single bundled plugin by `name`.
 *   - `getActivePlugins(ctx)` returns the bundled plugins active for the
 *     supplied project context, plus any external plugins the caller has
 *     pre-loaded.
 *
 * The registry holds NO mutable state past the initial lazy load. The
 * `BUILTIN_PLUGINS` array is frozen, every `PluginDef` in it is frozen, and
 * the lookup index (`Map`) is rebuilt from scratch each access if invoked
 * before the lazy load fires.
 *
 * Determinism (NFR-1 / SC-15): iteration order is alphabetical-by-name and
 * stable across runs.
 */

import { type DetectionContext, detectActivePlugins } from './detect.js';
import { loadBundledPlugins } from './loader.js';
import type { PluginDef } from './types.js';

let cachedPlugins: readonly PluginDef[] | undefined;
let cachedIndex: ReadonlyMap<string, PluginDef> | undefined;

function ensureLoaded(): void {
  if (cachedPlugins !== undefined) return;
  const plugins = loadBundledPlugins();
  cachedPlugins = plugins;
  const index = new Map<string, PluginDef>();
  for (const p of plugins) index.set(p.name, p);
  cachedIndex = index;
}

/**
 * Frozen array of every bundled plugin, alphabetical by `name`. The first
 * access lazy-loads the JSON corpus from disk; subsequent accesses are O(1).
 */
export function getBuiltinPlugins(): readonly PluginDef[] {
  ensureLoaded();
  return cachedPlugins ?? Object.freeze([]);
}

/**
 * Look up a single bundled plugin by name. Returns undefined when no plugin
 * with that name exists.
 */
export function getPlugin(name: string): PluginDef | undefined {
  ensureLoaded();
  return cachedIndex?.get(name);
}

/**
 * Filter the given plugin list (defaults to bundled + extras) to those
 * active for the supplied detection context. The result is the input order
 * preserved — for the bundled list this is alphabetical-by-name.
 *
 * `extras` is appended to the bundled list before filtering, so external
 * plugins can override or supplement bundled detection.
 */
export interface GetActivePluginsOptions {
  readonly extras?: readonly PluginDef[];
  readonly disable?: readonly string[];
}

export function getActivePlugins(
  ctx: DetectionContext,
  options?: GetActivePluginsOptions,
): readonly PluginDef[] {
  const bundled = getBuiltinPlugins();
  const disable = new Set(options?.disable ?? []);
  const merged: PluginDef[] = [];
  for (const p of bundled) {
    if (!disable.has(p.name)) merged.push(p);
  }
  for (const p of options?.extras ?? []) {
    if (!disable.has(p.name)) merged.push(p);
  }
  return detectActivePlugins(merged, ctx);
}

/**
 * Test-only — clear the lazy-load cache so a fresh data-directory state can
 * be observed across tests that mutate `src/data/`.
 */
export function __resetRegistryCacheForTest(): void {
  cachedPlugins = undefined;
  cachedIndex = undefined;
}
