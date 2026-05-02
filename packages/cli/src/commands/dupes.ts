/**
 * commands/dupes.ts — Phase 3h.2 (T184) — `fugazi dupes`.
 *
 * Runs the duplicate-detection family (`code-duplication` rule).
 */
import { FugaziCommand } from './base.js';
import { runAndReport } from './run-helpers.js';

export class DupesCommand extends FugaziCommand {
  static override paths = [['dupes']];
  static override usage = {
    description: 'Run the duplicate-detection rules',
  };

  override async execute(): Promise<number> {
    return await runAndReport({
      mode: 'dupes-only',
      format: this.pickFormat(),
      quiet: this.quiet,
      projectRoot: process.cwd(),
      stdout: this.context.stdout,
      stderr: this.context.stderr,
      ciPreset: this.isCiPreset(),
    });
  }
}
