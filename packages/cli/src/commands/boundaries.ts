/**
 * commands/boundaries.ts — Phase 3h.2 (T188) — `fugazi boundaries`.
 *
 * Single-rule shortcut for `boundary-violations`. Same severity-table-override
 * pattern as the unused-* shortcuts: every other rule flipped to `'off'` so
 * only zone violations surface.
 */
import { FugaziCommand } from './base.js';
import { buildSingleRuleTable, runAndReport } from './run-helpers.js';

const RULES = buildSingleRuleTable(['boundary-violations']);

export class BoundariesCommand extends FugaziCommand {
  static override paths = [['boundaries']];
  static override usage = {
    description: 'Run only the boundary-violations rule',
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
