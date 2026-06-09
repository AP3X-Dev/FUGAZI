/**
 * @fugazi/graph — public package surface.
 *
 * Phase 3d.1 (T079-T080) — path-sorted FileId assignment. The implementation
 * lives in `@fugazi/types` (FileId, ROOT_FILE_ID, assignFileIds,
 * compareFileIds) because the brand is consumed by every downstream package
 * (graph, core, lsp, mcp, v8-coverage). This barrel re-exports the surface
 * so consumers using `@fugazi/graph` see it as part of the graph API.
 *
 * Phase 3d.2 (T081-T090) — full import-specifier resolver. Synchronous,
 * never-throws-on-unresolved. The unified `resolve()` dispatches relative,
 * alias, tsconfig-paths, and node_modules strategies; the variant resolvers
 * (require, dynamic, react-native, fallbacks) and condition matching are
 * exposed as named utilities. See `./resolve/index.ts` for full surface.
 */

export {
  type FileId,
  ROOT_FILE_ID,
  assignFileIds,
  compareFileIds,
} from '@fugazi/types';

export type { Edge, EdgeKind, FileNode, Graph } from './types.js';
export type { BuildGraphOptions } from './build.js';
export { buildGraph } from './build.js';
export { classifyEdgeKind } from './edge-kinds.js';

export type {
  PropagatedExports,
  PropagationDiagnostic,
  Provenance,
} from './re-exports/propagate.js';
export {
  CAP_HIT_MESSAGE,
  MAX_ITERATIONS,
  describeDiagnostic,
  isReExportEdge,
  propagateReExports,
} from './re-exports/propagate.js';
export type { Cycle } from './re-exports/cycles.js';
export { detectReexportCycles } from './re-exports/cycles.js';
export type {
  StarAliasOverride,
  SynthesizedStars,
  SyntheticStarSymbol,
} from './re-exports/star.js';
export {
  isSyntheticStarSymbol,
  synthesizeStarExports,
  synthesizeStarSymbolName,
} from './re-exports/star.js';
export type { EntryStarTargets } from './re-exports/entry-targets.js';
export { buildEntryStarTargets } from './re-exports/entry-targets.js';

export type { ReverseIndices } from './reverse-index.js';
export { buildReverseIndices } from './reverse-index.js';

export { canonicalize } from './canonicalize.js';
export { getGitToplevel, __resetGitToplevelCacheForTest } from './git-toplevel.js';
export type { ChangedSinceOptions } from './changed-since.js';
export { getChangedSince } from './changed-since.js';

export {
  type DynamicImportSpec,
  type DynamicResolution,
  type FsAdapter,
  type ResolverContext,
  type Resolution,
  DEFAULT_ALIASES,
  DEFAULT_CONDITIONS,
  DEFAULT_RN_PLATFORMS,
  RELATIVE_EXTENSIONS,
  __clearPackageJsonCacheForTest,
  __clearTsconfigCacheForTest,
  createMemoryFsAdapter,
  findNearestTsconfig,
  matchesAliasPrefix,
  nodeFsAdapter,
  resolve,
  resolveAlias,
  resolveDynamic,
  resolveExports,
  resolveNodeModules,
  resolveReactNative,
  resolveRelative,
  resolveRequire,
  resolveTsconfigPaths,
  splitBareSpecifier,
  tryOutputToSourceFallback,
  tryWideIndexProbe,
} from './resolve/index.js';

export {
  type PythonManifest,
  EMPTY_PYTHON_MANIFEST,
  PYTHON_STDLIB_MODULES,
  buildSysPathRoots,
  extractRequirementName,
  findPackageRoot as findPythonPackageRoot,
  findVirtualenv,
  isAnyPackage,
  isPythonStdlib,
  isRegularPackage,
  loadPythonEntryPoints,
  loadPythonManifest,
  normalizePackageName,
  parseRelativeSpec,
  resolveInVirtualenv,
  resolvePyRelative,
  resolveSysPath,
} from './resolve-py/index.js';
