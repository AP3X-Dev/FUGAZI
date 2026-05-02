import type { RuleId } from '@fugazi/types';
/**
 * commands/explain.ts — Phase 3h.2 (T186) — `fugazi explain <rule-id>`.
 *
 * Per IMP-API-07 this is a SUBCOMMAND, not a `--explain` flag. Prints a
 * Markdown description for one of the 19 RuleId values, drawn from a static
 * map. Unknown rule names exit 2 with a verbatim message; valid ones exit 0.
 *
 * Each entry is intentionally short (4-6 lines) — full rule docs land in a
 * future phase.
 */
import { Command, Option } from 'clipanion';

const RULE_DESCRIPTIONS: Readonly<Record<RuleId, string>> = {
  'unused-files': [
    '# unused-files',
    '',
    'Severity: error (default)',
    '',
    'Flags TS/JS files in the project graph that are not reachable from any',
    'declared entry point (entrypoints config field, package.json `main`/',
    '`exports`/`bin`, framework-detected entries). Run `fugazi unused-files`',
    'or include the rule in the dead-code-only / full mode.',
    '',
    'Suppress: `// fugazi-ignore-file unused-files` at the top of the file.',
  ].join('\n'),
  'unused-exports': [
    '# unused-exports',
    '',
    'Severity: error (default)',
    '',
    'Flags exported bindings (functions, classes, vars, re-exports) that have',
    'no incoming graph edge from a static, dynamic, or type import. The export',
    'declaration site is the diagnostic anchor.',
    '',
    'Suppress: `// fugazi-ignore-next-line unused-exports`.',
  ].join('\n'),
  'unused-types': [
    '# unused-types',
    '',
    'Severity: error (default)',
    '',
    'Flags exported `type` / `interface` / `enum` declarations whose only',
    'consumers are also unused. Type-only rule — runtime exports stay clean.',
  ].join('\n'),
  'unused-deps': [
    '# unused-deps',
    '',
    'Severity: error (default)',
    '',
    'Flags entries in `package.json` `dependencies` that are never imported by',
    'project source. Pairs with unused-dev-deps and unused-optional-deps.',
  ].join('\n'),
  'unused-dev-deps': [
    '# unused-dev-deps',
    '',
    'Severity: error (default)',
    '',
    'Flags `devDependencies` entries with no static or dynamic import in the',
    'project. Test files participate in detection.',
  ].join('\n'),
  'unused-optional-deps': [
    '# unused-optional-deps',
    '',
    'Severity: error (default)',
    '',
    'Flags `optionalDependencies` entries with no usage. Optional deps without',
    'imports are usually leftover from a removed feature.',
  ].join('\n'),
  'unused-enum-members': [
    '# unused-enum-members',
    '',
    'Severity: error (default)',
    '',
    'Flags enum members that are never referenced. The enum itself may still',
    'be used; this rule narrows to the per-member level.',
  ].join('\n'),
  'unused-class-members': [
    '# unused-class-members',
    '',
    'Severity: error (default)',
    '',
    'Flags private/protected class members with no in-class reference. Public',
    'members are out-of-scope (subject to external use).',
  ].join('\n'),
  'circular-dependencies': [
    '# circular-dependencies',
    '',
    'Severity: error (default)',
    '',
    'Flags simple cycles in the static-import graph. Reports the smallest',
    'cycle covering each strongly-connected component.',
    '',
    'Suppress: `// fugazi-ignore-file circular-dependencies`.',
  ].join('\n'),
  'boundary-violations': [
    '# boundary-violations',
    '',
    'Severity: error (default)',
    '',
    'Flags imports that cross a configured boundary (config `zones` field).',
    'Each violation names the source zone, target zone, and offending edge.',
  ].join('\n'),
  'unresolved-imports': [
    '# unresolved-imports',
    '',
    'Severity: error (default)',
    '',
    'Flags import specifiers that do not resolve to any project file or',
    'declared package. Includes typos and missing dependency entries.',
  ].join('\n'),
  'unlisted-dependencies': [
    '# unlisted-dependencies',
    '',
    'Severity: error (default)',
    '',
    'Flags imports of bare specifiers whose package is not declared in any',
    'section of `package.json`. Catches "phantom dependencies".',
  ].join('\n'),
  'duplicate-exports': [
    '# duplicate-exports',
    '',
    'Severity: error (default)',
    '',
    'Flags multiple exports under the same name in the same module — usually',
    'a copy-paste error during refactors.',
  ].join('\n'),
  'private-type-leak': [
    '# private-type-leak',
    '',
    'Severity: error (default)',
    '',
    'Flags public exports whose type signature references a non-exported',
    'symbol. Such leaks make consumer typecheck output fragile.',
  ].join('\n'),
  'complexity-hotspot': [
    '# complexity-hotspot',
    '',
    'Severity: error (default)',
    '',
    'Flags functions whose cyclomatic complexity exceeds the configured',
    'threshold (default 10). Tune via `health.cyclomaticThreshold`.',
  ].join('\n'),
  'cognitive-complexity': [
    '# cognitive-complexity',
    '',
    'Severity: error (default)',
    '',
    'Flags functions whose cognitive complexity exceeds the configured',
    'threshold (default 15). Tune via `health.cognitiveThreshold`.',
  ].join('\n'),
  'code-duplication': [
    '# code-duplication',
    '',
    'Severity: error (default)',
    '',
    'Flags clone families across files: exact duplicates, renamed-token',
    'clones, structural near-duplicates, and semantic siblings.',
  ].join('\n'),
  'cold-code': [
    '# cold-code',
    '',
    'Severity: warn (default)',
    '',
    'Runtime-intelligence rule. Flags code with measured zero or near-zero',
    'execution coverage in production traces.',
  ].join('\n'),
  'hot-path': [
    '# hot-path',
    '',
    'Severity: warn (default)',
    '',
    'Runtime-intelligence rule. Surfaces files dominating production CPU/wall',
    'time so refactors can target real load rather than guessed hotspots.',
  ].join('\n'),
};

export class ExplainCommand extends Command {
  static override paths = [['explain']];
  static override usage = {
    description: 'Print a Markdown description for a single rule id',
  };

  rule = Option.String({ name: 'rule-id', required: true });

  override async execute(): Promise<number> {
    const text = (RULE_DESCRIPTIONS as Record<string, string | undefined>)[this.rule];
    if (text === undefined) {
      this.context.stderr.write(`fugazi explain: unknown rule id: ${this.rule}\n`);
      return 2;
    }
    this.context.stdout.write(text);
    if (!text.endsWith('\n')) this.context.stdout.write('\n');
    return 0;
  }
}
