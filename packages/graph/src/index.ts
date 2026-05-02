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
