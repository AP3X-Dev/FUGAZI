import { type AnalysisAction, applyFixes, runAnalysis } from '@fugazi/core';
import type { RuleId } from '@fugazi/types';
/**
 * commands/fix.ts — Phase 3h.6 (T211-T214) — `bunx fugazi fix`.
 *
 * Runs full analysis once, applies every action whose `diagnostic.kind` passes
 * the `--rule` filter (or all if not provided), via the shared
 * `applyFixes` engine in `@fugazi/core`. `--dry-run` prints the would-be edits
 * and never writes.
 *
 * Exit codes:
 *   - 0 — fixes applied, dry-run completed, or no actions needed.
 *   - 1 — at least one file failed (drift, IO error).
 *
 * Verbatim lines emitted to stdout (CONTRACT, fixture-asserted by tests):
 *
 *   `applied: <file> (<n> edits)`
 *   `unchanged: <file>`
 *   `error: <message>`
 *   `dry-run: <file> (<n> edits)`
 */
import { Command, Option } from 'clipanion';
import { loadFugaziConfig } from './run-helpers.js';

export class FixCommand extends Command {
  static override paths = [['fix']];
  static override usage = {
    description: 'Apply machine-applicable fixes',
    details:
      'Runs the full analysis and applies every machine-applicable action. Use --dry-run to preview, --rule <id> to filter to a single rule.',
  };

  dryRun = Option.Boolean('--dry-run', false, {
    description: 'Preview fixes without writing to disk',
  });

  rule = Option.Array('--rule', {
    description: 'Filter to a specific rule id (repeatable)',
  });

  override async execute(): Promise<number> {
    const projectRoot = process.cwd();
    const cfg = await loadFugaziConfig(projectRoot);
    const result = await runAnalysis({
      kind: 'full',
      config: cfg,
      projectRoot,
    });

    const actions: readonly AnalysisAction[] = result.actions;
    const filter = (this.rule ?? []) as readonly RuleId[];

    const fix = await applyFixes({
      actions,
      ...(filter.length > 0 ? { ruleFilter: filter } : {}),
      dryRun: this.dryRun,
    });

    if (this.dryRun) {
      for (const planned of fix.plan) {
        this.context.stdout.write(`dry-run: ${planned.file} (${planned.edits.length} edits)\n`);
      }
      if (fix.plan.length === 0) {
        this.context.stdout.write('dry-run: no fixes needed\n');
      }
      return 0;
    }

    for (const outcome of fix.outcomes) {
      switch (outcome.status) {
        case 'applied':
          this.context.stdout.write(`applied: ${outcome.file} (${outcome.editCount} edits)\n`);
          break;
        case 'unchanged':
          this.context.stdout.write(`unchanged: ${outcome.file}\n`);
          break;
        case 'drift':
        case 'missing':
        case 'error':
          this.context.stderr.write(`error: ${outcome.message}\n`);
          break;
      }
    }

    if (fix.outcomes.length === 0) {
      this.context.stdout.write('fix: no fixes needed\n');
    }

    return fix.errors > 0 ? 1 : 0;
  }
}
