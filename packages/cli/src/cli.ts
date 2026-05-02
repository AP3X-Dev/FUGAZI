/**
 * cli.ts — Phase 3h.2 (T181) — top-level CLI entry point.
 *
 * `runCli(argv, context)` builds a `Cli` from `ALL_COMMANDS`, registers the
 * builtin `--help` and `--version` handlers, intercepts the rejected `--ci`
 * flag (per F1 — IMP-API-07), and dispatches.
 *
 * Determinism: command ordering is fixed by `ALL_COMMANDS` (alphabetical), and
 * the `--ci` rejection emits a single verbatim line then exits 2 with no
 * further side-effects. The shared `BaseContext` honours injected stdout /
 * stderr / env so tests can capture output without spawning a child process.
 */
import { type BaseContext, Builtins, Cli } from 'clipanion';
import { ALL_COMMANDS } from './commands/index.js';

/** Verbatim message emitted when `--ci` is encountered. */
export const CI_REJECTION_MESSAGE = '--ci is removed; use --preset ci instead';

/** Build a `Cli` instance carrying every registered command + builtins. */
export function buildCli(): Cli<BaseContext> {
  const cli = Cli.from<BaseContext>([...ALL_COMMANDS], {
    binaryName: 'fugazi',
    binaryLabel: 'Fugazi',
    binaryVersion: '0.0.0',
    enableCapture: false,
  });
  cli.register(Builtins.HelpCommand);
  cli.register(Builtins.VersionCommand);
  return cli;
}

/**
 * Run the CLI. Rejects `--ci` early (anywhere on the command line) per F1, and
 * delegates everything else to clipanion's dispatcher.
 */
export async function runCli(
  argv: readonly string[],
  context?: Partial<BaseContext>,
): Promise<number> {
  if (argv.includes('--ci')) {
    const stderr: NodeJS.WritableStream = context?.stderr ?? process.stderr;
    stderr.write(`${CI_REJECTION_MESSAGE}\n`);
    return 2;
  }
  const cli = buildCli();
  return await cli.run([...argv], context ?? {});
}
