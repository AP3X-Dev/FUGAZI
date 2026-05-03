/**
 * reporter/index.ts — Phase 3j barrel.
 *
 * Re-exports the public Reporter surface: the `Reporter` interface,
 * `ReporterMeta` / `ReporterFormat` types, the `selectReporter` factory, the
 * shared `ReporterBase` state machine, and the seven format-specific classes.
 * CLI / LSP / MCP / Node-API consume exclusively from here.
 */

export { ReporterBase } from './base.js';
export { CodeclimateReporter } from './codeclimate.js';
export { CompactReporter } from './compact.js';
export { HumanPlainReporter } from './human-plain.js';
export { HumanReporter } from './human.js';
export { JsonReporter } from './json.js';
export { MarkdownReporter } from './markdown.js';
export { SarifReporter } from './sarif.js';
export { selectReporter } from './select.js';
export type { Reporter, ReporterFormat, ReporterMeta } from './types.js';
