import type { ReporterFormat } from '@fugazi/core';
/**
 * commands/watch.ts — Phase 3h.6 (T205) — `bunx fugazi watch`.
 *
 * Re-runs the full analysis on every coalesced filesystem change, rendering
 * via the same reporters used by every other CLI command. SIGINT contract:
 * first press cancels the in-flight analysis (verbatim line to stderr);
 * second press within 2s exits 130.
 *
 * The optional `<command>` positional is reserved (the help text mentions
 * `<command>` but the body always re-runs analysis in v1).
 */
import { Command, Option } from 'clipanion';
import { runWatch } from '../watch/index.js';

const VALID_FORMATS: readonly ReporterFormat[] = [
  'human',
  'human-plain',
  'json',
  'sarif',
  'compact',
  'markdown',
  'codeclimate',
];

export class WatchCommand extends Command {
  static override paths = [['watch']];
  static override usage = {
    description: 'Re-run analysis on file changes',
    details:
      'Watches the project root for source-file changes and re-runs the full analysis pipeline. Press Ctrl-C to cancel the in-flight run; press Ctrl-C twice to exit.',
  };

  format = Option.String('--format', 'human', {
    description:
      'Output format: human | human-plain | json | sarif | compact | markdown | codeclimate',
  });

  quiet = Option.Boolean('--quiet,-q', false, {
    description: 'Suppress progress output',
  });

  override async execute(): Promise<number> {
    const stdoutLike = this.context.stdout as { isTTY?: boolean };
    const env = this.context.env;
    const requested = VALID_FORMATS.includes(this.format as ReporterFormat)
      ? (this.format as ReporterFormat)
      : 'human';
    const noColor = typeof env.NO_COLOR === 'string' && env.NO_COLOR.length > 0;
    const notTty = stdoutLike.isTTY !== true;
    const resolvedFormat: ReporterFormat =
      requested === 'human' && (noColor || notTty) ? 'human-plain' : requested;

    const handle = await runWatch({
      projectRoot: process.cwd(),
      format: resolvedFormat,
      quiet: this.quiet,
      stdout: this.context.stdout,
      stderr: this.context.stderr,
    });
    return await handle.exit;
  }
}
