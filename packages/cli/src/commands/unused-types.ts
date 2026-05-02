/**
 * commands/unused-types.ts — Phase 3h.2 — single-rule shortcut.
 */
import { FugaziCommand } from './base.js';
import { buildSingleRuleTable, runAndReport } from './run-helpers.js';

const RULES = buildSingleRuleTable(['unused-types']);

export class UnusedTypesCommand extends FugaziCommand {
  static override paths = [['unused-types']];
  static override usage = {
    description: 'Run only the unused-types rule',
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
