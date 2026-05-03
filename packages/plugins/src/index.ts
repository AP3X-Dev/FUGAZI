/**
 * index.ts — public surface of @fugazi/plugins (Phase 3i Wave A).
 *
 * Re-exports the declarative plugin type system, the Zod runtime validator,
 * the bundled-plugin registry, and the detection helpers. Consumers (the
 * core analysis driver and external tooling) import only from this module.
 */

export type {
  EntryPointRole,
  PluginDef,
  PluginDetection,
  ScopedUsedClassMember,
  UsedClassMember,
  UsedExport,
} from './types.js';

export {
  EntryPointRoleSchema,
  PluginDefSchema,
  PluginDetectionSchema,
  ScopedUsedClassMemberSchema,
  UsedClassMemberSchema,
  UsedExportSchema,
} from './schema.js';

export {
  loadBundledPlugins,
  loadBundledPluginsVerbose,
  loadExternalPlugin,
  tryValidatePlugin,
  validatePlugin,
  type ValidationResult,
  type VerboseLoadResult,
} from './loader.js';

export {
  collectDependencyNames,
  detectActivePlugins,
  evaluateDetection,
  isPluginActive,
  matchesEnabler,
  type DetectionContext,
  type PackageJsonForDetection,
} from './detect.js';

export {
  getActivePlugins,
  getBuiltinPlugins,
  getPlugin,
  __resetRegistryCacheForTest,
  type GetActivePluginsOptions,
} from './registry.js';

export { globToRegExp, matchesGlob } from './matcher.js';
