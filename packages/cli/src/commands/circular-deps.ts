/**
 * commands/circular-deps.ts — Phase 3h.2 — single-rule shortcut.
 */
import { FugaziCommand } from './base.js';
import { buildSingleRuleTable, runAndReport } from './run-helpers.js';

const RULES = buildSingleRuleTable(['circular-dependencies']);

export class CircularDepsCommand extends FugaziCommand {
  static override paths = [['circular-deps']];
  static override usage = {
    description: 'Run only the circular-dependencies rule',
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
