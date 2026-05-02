/**
 * @fugazi/node-api — public surface for programmatic consumers.
 *
 * Phase 3h.5 (T201-T204) ships the SIX top-level functions defined in
 * IMP-ARCH-11. Per IMP-API-02 the original Fallow `detect_dead_code`,
 * `detect_unused_files`, `detect_unused_exports` trio collapses into a single
 * `analyze()` with a discriminated `rules` option — those three names are NOT
 * exported here.
 *
 * The package is published as `@fugazi/node` (the workspace name
 * `@fugazi/node-api` is path-clarity only).
 */

export { analyze } from './analyze.js';
export { audit } from './audit.js';
export { findDupes } from './find-dupes.js';
export { health } from './health.js';
export { traceExport, traceFile } from './trace.js';

export type {
  AnalyzeOptions,
  AnalyzeResult,
  AnalyzeRulesOption,
  AuditOptions,
  AuditResult,
  CoverageRootOption,
  DupesResult,
  FindDupesOptions,
  HealthOptions,
  HealthResult,
  TraceExportOptions,
  TraceFileOptions,
  TraceResult,
} from './types.js';
