import { NO_RUNNER_MESSAGE, buildSnippets, detectRunners } from '@fugazi/core';
/**
 * commands/coverage-setup.ts — Phase 3h.6 (T215-T217) — `coverage setup`.
 *
 * Detects the project's test runner(s) and prints per-runner V8-coverage
 * configuration snippets. v1 prints only — does NOT write to user config
 * files (per the autonomous-decision list).
 *
 * Exit codes:
 *   - 0 — at least one runner detected.
 *   - 2 — no supported runner detected (verbatim message to stderr).
 */
import { Command } from 'clipanion';

export class CoverageSetupCommand extends Command {
  static override paths = [['coverage', 'setup']];
  static override usage = {
    description: 'Wire up V8 coverage capture',
    details:
      'Detects vitest, jest, or playwright in the project and prints config snippets so the runner emits V8 coverage in a shape Fugazi understands.',
  };

  override async execute(): Promise<number> {
    const projectRoot = process.cwd();
    const detected = await detectRunners({ projectRoot });
    if (detected.length === 0) {
      this.context.stderr.write(`${NO_RUNNER_MESSAGE}\n`);
      return 2;
    }
    const snippets = buildSnippets(projectRoot, detected);
    for (const entry of snippets) {
      this.context.stdout.write(`# ${entry.runner}\n`);
      this.context.stdout.write(`# write to: ${entry.configPath}\n`);
      this.context.stdout.write(entry.snippet);
      if (!entry.snippet.endsWith('\n')) this.context.stdout.write('\n');
      this.context.stdout.write('\n');
    }
    return 0;
  }
}
