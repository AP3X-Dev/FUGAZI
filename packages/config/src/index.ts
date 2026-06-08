/**
 * @fugazi/config — public surface.
 *
 * Phase 3c.1: schema + per-format loaders, extends-chain resolver,
 * framework-preset detection, workspace discovery, and the hidden-dir
 * allowlist. The remaining 3c sub-phases (parser adapter, parse cache,
 * visitor, SFC handlers, suppression, complexity) live elsewhere in the
 * workspace.
 */
export { defineConfig } from './define-config.js';
export {
  DEFAULT_FETCH_TIMEOUT_MS,
  MAX_EXTENDS_DEPTH,
  MAX_REMOTE_BODY_BYTES,
  type ResolveExtendsOptions,
  resolveExtendsChain,
} from './extends-chain.js';
export {
  HIDDEN_DIR_ALLOWLIST,
  isHiddenDirAllowed,
  shouldTraverseHidden,
} from './hidden-dirs.js';
export { loadJsonConfig } from './loaders/json.js';
export { loadTomlConfig } from './loaders/toml.js';
export { loadTsConfig } from './loaders/ts.js';
export { detectFrameworks } from './preset-detect.js';
export { type FugaziConfig, FugaziConfigSchema, FugaziConfigSchemaPermissive } from './schema.js';
export { discoverWorkspaces, type WorkspaceInfo } from './workspace-discovery.js';
