/**
 * reporter/index.ts — Phase 3h.1 barrel.
 *
 * Re-exports the public Reporter surface: the `Reporter` interface and
 * `ReporterMeta` / `ReporterFormat` types, the `selectReporter` factory, and
 * the seven format-specific stub classes. CLI / LSP / MCP / Node-API consume
 * exclusively from here.
 */

export { selectReporter } from './select.js';
export {
  CodeclimateReporter,
  CompactReporter,
  HumanPlainReporter,
  HumanReporter,
  JsonReporter,
  MarkdownReporter,
  SarifReporter,
} from './stubs.js';
export type { Reporter, ReporterFormat, ReporterMeta } from './types.js';
