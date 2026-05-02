/**
 * @fugazi/cli — public surface (Phase 3h.2).
 *
 * `run(argv)` is the entry the `bin/fugazi.js` launcher invokes. It delegates
 * to `runCli` (which builds the clipanion `Cli` from the registered command
 * classes) so launchers and tests share the same dispatch path.
 */
import { runCli } from './cli.js';

export { runCli, buildCli, CI_REJECTION_MESSAGE } from './cli.js';
export { ALL_COMMANDS } from './commands/index.js';

export async function run(argv: string[]): Promise<number> {
  return await runCli(argv);
}
