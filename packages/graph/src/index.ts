/**
 * @fugazi/graph — public package surface.
 *
 * Phase 3d.1 (T079-T080) — path-sorted FileId assignment. The implementation
 * lives in `@fugazi/types` (FileId, ROOT_FILE_ID, assignFileIds,
 * compareFileIds) because the brand is consumed by every downstream package
 * (graph, core, lsp, mcp, v8-coverage). This barrel re-exports the surface
 * so consumers using `@fugazi/graph` see it as part of the graph API.
 *
 * Phase 3d.2+ (resolver, module graph construction, re-export propagation)
 * will populate this package directly.
 */

export {
  type FileId,
  ROOT_FILE_ID,
  assignFileIds,
  compareFileIds,
} from '@fugazi/types';
