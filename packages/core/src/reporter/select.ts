/**
 * reporter/select.ts — Phase 3h.1 (T179-T180) — `selectReporter` factory.
 *
 * One-line dispatch from a `ReporterFormat` discriminator to a fresh stub
 * instance. The CLI driver, LSP serializer, MCP `_meta` packer, and Node-API
 * consumer all flow through this single seam — so adding a format requires
 * (a) widening `ReporterFormat`, (b) shipping a stub class in `./stubs.ts`,
 * (c) registering it in the switch below. The `never` exhaustiveness guard
 * makes (a) without (c) a compile error.
 */

import {
  CodeclimateReporter,
  CompactReporter,
  HumanPlainReporter,
  HumanReporter,
  JsonReporter,
  MarkdownReporter,
  SarifReporter,
} from './stubs.js';
import type { Reporter, ReporterFormat } from './types.js';

export function selectReporter(format: ReporterFormat): Reporter {
  switch (format) {
    case 'human':
      return new HumanReporter();
    case 'human-plain':
      return new HumanPlainReporter();
    case 'json':
      return new JsonReporter();
    case 'sarif':
      return new SarifReporter();
    case 'compact':
      return new CompactReporter();
    case 'markdown':
      return new MarkdownReporter();
    case 'codeclimate':
      return new CodeclimateReporter();
    default: {
      // Exhaustiveness check — adding a new ReporterFormat without a case
      // here is a compile error.
      const _exhaustive: never = format;
      throw new Error(`Unknown reporter format: ${_exhaustive as string}`);
    }
  }
}
