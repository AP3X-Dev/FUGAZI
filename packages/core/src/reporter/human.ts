/**
 * reporter/human.ts — Phase 3j — colour-aware human reporter.
 *
 * Self-checks `meta.tty`, then `process.stdout.isTTY`, and the `NO_COLOR`
 * environment variable. When colour is suppressed the reporter falls through
 * to the plain renderer (byte-equal to `HumanPlainReporter`).
 */

import { ReporterBase } from './base.js';
import { ansiStyle, plainStyle, renderHuman } from './human-render.js';
import type { ReporterFormat, ReporterMeta } from './types.js';

function colourEnabled(meta: ReporterMeta | undefined): boolean {
  // Self-check the environment so the reporter is robust when called
  // without an explicit `meta.tty` hint (e.g. from MCP / Node-API).
  const noColor = process.env.NO_COLOR;
  if (noColor !== undefined && noColor !== '') {
    return false;
  }
  const isTty = Boolean(process.stdout.isTTY);
  // `meta` is reserved for future plumbing of explicit `tty` overrides; for
  // now we treat `process.stdout.isTTY` as authoritative.
  void meta;
  return isTty;
}

/** `human` — terminal output with ANSI colour when stdout is a TTY. */
export class HumanReporter extends ReporterBase {
  protected override readonly format: ReporterFormat = 'human';

  protected override serialize(meta: ReporterMeta | undefined): string {
    const style = colourEnabled(meta) ? ansiStyle : plainStyle;
    return renderHuman(this.issues, this.events, meta, style);
  }
}
