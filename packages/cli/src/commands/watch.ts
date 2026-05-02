/**
 * commands/watch.ts — Phase 3h.2 stub. Body lands in Phase 3h.6.
 *
 * Registered so `--help` advertises the full surface; the body just emits a
 * verbatim "not implemented" line and exits 2.
 */
import { Command } from 'clipanion';

export class WatchCommand extends Command {
  static override paths = [['watch']];
  static override usage = {
    description: 'Re-run analysis on file changes (stub — lands in Phase 3h.6)',
  };

  override async execute(): Promise<number> {
    this.context.stderr.write('watch: not implemented yet (Phase 3h.6)\n');
    return 2;
  }
}
