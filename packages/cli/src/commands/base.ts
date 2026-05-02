import type { ReporterFormat } from '@fugazi/core';
/**
 * commands/base.ts — Phase 3h.2 (T181) — shared command base.
 *
 * Every analysis command (`dead-code`, `dupes`, `health`, `audit`, the per-rule
 * shortcuts, `boundaries`) extends `FugaziCommand`. The base carries the
 * cross-cutting flags (`--quiet`, `--format`, `--preset`) and provides the
 * shared `pickFormat()` helper that resolves the auto-fallback from `human`
 * to `human-plain` per IMP-API-05 (no-color env var or non-TTY stdout).
 *
 * Meta commands (`init`, `schema`, `explain`, `trace`, `boundaries`) and stub
 * commands (`watch`, `fix`, `coverage setup`) are free to extend `Command`
 * directly when they don't need the analysis flags.
 */
import { Command, Option } from 'clipanion';

const VALID_FORMATS: readonly ReporterFormat[] = [
  'human',
  'human-plain',
  'json',
  'sarif',
  'compact',
  'markdown',
  'codeclimate',
];

/** Shared flags carried by every analysis-style command. */
export abstract class FugaziCommand extends Command {
  /** Suppress progress output. */
  quiet = Option.Boolean('--quiet,-q', false, {
    description: 'Suppress progress output',
  });

  /** Output format. Default `human`; auto-falls-back to `human-plain` on no-color/pipe. */
  format = Option.String('--format', 'human', {
    description:
      'Output format: human | human-plain | json | sarif | compact | markdown | codeclimate',
  });

  /** Preset bundle. `ci` => format=human-plain, quiet=true. */
  preset = Option.String('--preset', {
    description: "Preset: 'ci' (= --format human-plain --quiet)",
  });

  /**
   * Resolve the effective `ReporterFormat` for the run, honouring `--preset`,
   * the `NO_COLOR` env var, and stdout TTY detection per IMP-API-05.
   *
   * Precedence: `--preset ci` > explicit `--format` > default `human`. Returns
   * `human-plain` when the resolved value is `human` and either `NO_COLOR` is
   * set or stdout is not a TTY (auto-degrade so piped invocations produce
   * grep-friendly output).
   */
  protected pickFormat(): ReporterFormat {
    if (this.preset === 'ci') return 'human-plain';
    const requested = this.format;
    if (!VALID_FORMATS.includes(requested as ReporterFormat)) {
      // Defensive: clipanion can't enumerate-validate strings without typanion;
      // bad values fall through to `human` and emit a stderr note via the
      // caller. Reporting the error is the caller's job.
      return 'human';
    }
    const resolved = requested as ReporterFormat;
    if (resolved !== 'human') return resolved;

    const env = this.context.env;
    const noColor = typeof env.NO_COLOR === 'string' && env.NO_COLOR.length > 0;
    const stdout = this.context.stdout as { isTTY?: boolean };
    const notTty = stdout.isTTY !== true;
    return noColor || notTty ? 'human-plain' : 'human';
  }

  /** True when the resolved preset/flags indicate CI mode. */
  protected isCiPreset(): boolean {
    return this.preset === 'ci';
  }

  abstract override execute(): Promise<number>;
}
