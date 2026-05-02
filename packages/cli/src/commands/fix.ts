/**
 * commands/fix.ts — Phase 3h.2 stub. Body lands in Phase 3h.6.
 */
import { Command } from 'clipanion';

export class FixCommand extends Command {
  static override paths = [['fix']];
  static override usage = {
    description: 'Apply machine-applicable fixes (stub — lands in Phase 3h.6)',
  };

  override async execute(): Promise<number> {
    this.context.stderr.write('fix: not implemented yet (Phase 3h.6)\n');
    return 2;
  }
}
