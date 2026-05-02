/**
 * canonicalize.ts — Phase 3d.6 (T104-T105) — re-export of the cross-platform
 * canonicalize helper.
 *
 * The implementation lives in @fugazi/types (packages/types/src/canonicalize.ts)
 * because path canonicalization is foundationally cross-cutting — config,
 * extract, graph, lsp, and core all need it. This file re-publishes the
 * surface so consumers using @fugazi/graph see it as part of the graph API.
 *
 * Behavior (cf. IMP-MOD-05): always-async, resolves symlinks via fs.realpath,
 * strips Windows \\?\ verbatim prefix, normalizes backslashes to forward
 * slashes, uppercases drive letters, strips trailing slashes (except FS roots).
 * macOS /private/tmp redirect is handled by realpath natively (no special
 * case). Errors wrap as FugaziError(code: FS_PATH_NOT_FOUND).
 */
export { canonicalize } from '@fugazi/types';
