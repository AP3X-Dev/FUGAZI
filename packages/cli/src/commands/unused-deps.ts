/**
 * commands/unused-deps.ts — Phase 3h.2 — single-rule-trio shortcut.
 *
 * Enables the three dependency-family rules together (regular / dev / optional)
 * since they're conceptually one concern split across `package.json` sections.
 */
import { FugaziCommand } from './base.js';
import { buildSingleRuleTable, runAndReport } from './run-helpers.js';

const RULES = buildSingleRuleTable(['unused-deps', 'unused-dev-deps', 'unused-optional-deps']);

export class UnusedDepsCommand extends FugaziCommand {
  static override paths = [['unused-deps']];
  static override usage = {
    description: 'Run the unused-deps / unused-dev-deps / unused-optional-deps rules',
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
