/**
 * commands/unused-files.ts — Phase 3h.2 — single-rule shortcut.
 *
 * Runs in `full` mode with every rule severity flipped to `'off'` except
 * `unused-files`. The same shape (single-rule override, full-mode dispatch)
 * powers the per-rule shortcuts for unused-exports/types/deps and the
 * `boundaries` command.
 */
import { FugaziCommand } from './base.js';
import { buildSingleRuleTable, runAndReport } from './run-helpers.js';

const RULES = buildSingleRuleTable(['unused-files']);

export class UnusedFilesCommand extends FugaziCommand {
  static override paths = [['unused-files']];
  static override usage = {
    description: 'Run only the unused-files rule',
  };

  override async execute(): Promise<number> {
    return await runAndReport({
      mode: 'full',
      format: this.pickFormat(),
      quiet: this.quiet,
      projectRoot: process.cwd(),
      singleRules: RULES,
      stdout: this.context.stdout,
      stderr: this.context.stderr,
      ciPreset: this.isCiPreset(),
    });
  }
}
