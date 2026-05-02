/**
 * commands/dead-code.ts — Phase 3h.2 (T184) — `fugazi dead-code`.
 *
 * Dispatches `runAnalysis({ kind: 'dead-code-only' })` for the whole project at
 * `process.cwd()`. The dead-code-only mode runs every dead-code-family rule
 * (unused-* + circular-dependencies + boundary-violations + import-hygiene
 * trio + private-type-leak) — see `@fugazi/core` registry.
 */
import { FugaziCommand } from './base.js';
import { runAndReport } from './run-helpers.js';

export class DeadCodeCommand extends FugaziCommand {
  static override paths = [['dead-code']];
  static override usage = {
    description: 'Run all dead-code-family rules',
  };

  override async execute(): Promise<number> {
    return await runAndReport({
      mode: 'dead-code-only',
      format: this.pickFormat(),
      quiet: this.quiet,
      projectRoot: process.cwd(),
      stdout: this.context.stdout,
      stderr: this.context.stderr,
      ciPreset: this.isCiPreset(),
    });
  }
}
