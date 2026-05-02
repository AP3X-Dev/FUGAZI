/**
 * commands/coverage-setup.ts — Phase 3h.2 stub. Body lands in Phase 3h.6.
 *
 * Two-word command via `static paths = [['coverage', 'setup']]`.
 */
import { Command } from 'clipanion';

export class CoverageSetupCommand extends Command {
  static override paths = [['coverage', 'setup']];
  static override usage = {
    description: 'Wire up V8 coverage capture (stub — lands in Phase 3h.6)',
  };

  override async execute(): Promise<number> {
    this.context.stderr.write('coverage setup: not implemented yet (Phase 3h.6)\n');
    return 2;
  }
}
