/**
 * commands/init.ts — Phase 3h.2 (T186) — `fugazi init`.
 *
 * Writes `.fugazirc.json` (the canonical config filename per Phase 3c.1) as
 * JSONC with comments explaining every populated field. The `frameworks`
 * array is auto-detected from `package.json` via `detectFrameworks`. Refuses
 * to overwrite an existing config without `--force`; the refusal string is
 * verbatim per the phase brief.
 *
 * Determinism (NFR-1): the same project state produces the same file
 * byte-for-byte. Detected framework names are sorted by `detectFrameworks`,
 * and the JSONC template uses no timestamps or random values.
 */
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { detectFrameworks } from '@fugazi/config';
import { Command, Option } from 'clipanion';

const REFUSAL_MESSAGE = 'fugazi init: .fugazirc.json already exists; pass --force to overwrite';

export class InitCommand extends Command {
  static override paths = [['init']];
  static override usage = {
    description: 'Write .fugazirc.json with framework presets detected from package.json',
  };

  force = Option.Boolean('--force', false, {
    description: 'Overwrite an existing .fugazirc.json',
  });

  override async execute(): Promise<number> {
    const projectRoot = process.cwd();
    const target = join(projectRoot, '.fugazirc.json');
    if (existsSync(target) && !this.force) {
      this.context.stderr.write(`${REFUSAL_MESSAGE}\n`);
      return 2;
    }
    const frameworks = await detectFrameworks(projectRoot);
    const body = renderTemplate(frameworks);
    await writeFile(target, body, 'utf8');
    this.context.stdout.write(`fugazi init: wrote ${target}\n`);
    return 0;
  }
}

/** JSONC template; deterministic byte-equal output for identical inputs. */
function renderTemplate(frameworks: readonly string[]): string {
  const frameworksJson =
    frameworks.length === 0 ? '[]' : `[${frameworks.map((f) => JSON.stringify(f)).join(', ')}]`;
  return [
    '// Fugazi configuration. JSONC syntax (comments + trailing commas allowed).',
    '// Run `fugazi schema` for the full field reference.',
    '{',
    '  // Per-rule severity overrides. Defaults are "error".',
    '  "rules": {},',
    '',
    '  // File patterns analysed. Default covers every TS/JS source extension.',
    '  "include": ["**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}"],',
    '',
    '  // File patterns excluded before analysis.',
    '  "exclude": ["node_modules", "dist", "build", "coverage"],',
    '',
    '  // Detected framework presets (auto-populated from package.json).',
    `  "frameworks": ${frameworksJson},`,
    '',
    '  // Entry points seed reachability analysis (unused files / exports / deps).',
    '  // By default Fugazi auto-detects them from conventions (src/index, main,',
    '  // cli, bin, *.config, test files; Python __main__.py, manage.py, app.py,',
    '  // conftest.py, test_*.py) and from package.json / pyproject manifests.',
    '  // Set an explicit list of globs to override auto-detection, e.g.:',
    '  //   "entrypoints": ["src/index.ts", "src/cli.ts"],',
    '',
    '  // Boundary zones for the boundary-violations rule. Empty by default.',
    '  "zones": {},',
    '',
    '  // Reject unknown top-level keys when true.',
    '  "strict": false',
    '}',
    '',
  ].join('\n');
}
