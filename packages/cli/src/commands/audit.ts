/**
 * commands/audit.ts — Phase 3h.2 (T184) — `fugazi audit`.
 *
 * Read-only inventory dump. The driver still walks discover + extract + graph
 * but emits zero diagnostics regardless of registered rules.
 */
import { FugaziCommand } from './base.js';
import { runAndReport } from './run-helpers.js';

export class AuditCommand extends FugaziCommand {
  static override paths = [['audit']];
  static override usage = {
    description: 'Read-only inventory dump (no rule dispatch)',
  };

  override async execute(): Promise<number> {
    return await runAndReport({
      mode: 'audit',
      format: this.pickFormat(),
      quiet: this.quiet,
      projectRoot: process.cwd(),
      stdout: this.context.stdout,
      stderr: this.context.stderr,
      ciPreset: this.isCiPreset(),
    });
  }
}
