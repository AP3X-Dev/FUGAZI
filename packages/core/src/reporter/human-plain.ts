/**
 * reporter/human-plain.ts — Phase 3j — plain-ASCII human reporter.
 *
 * Always renders without ANSI colour codes. Used by CLI when `--no-color` is
 * set, when stdout is piped, when `NO_COLOR` env is present, and by every
 * non-CLI consumer (MCP `_meta` packer, programmatic Node API).
 */

import { ReporterBase } from './base.js';
import { plainStyle, renderHuman } from './human-render.js';
import type { ReporterFormat, ReporterMeta } from './types.js';

/** `human-plain` — same content as `human`, ANSI codes always stripped. */
export class HumanPlainReporter extends ReporterBase {
  protected override readonly format: ReporterFormat = 'human-plain';

  protected override serialize(meta: ReporterMeta | undefined): string {
    return renderHuman(this.issues, this.events, meta, plainStyle);
  }
}
