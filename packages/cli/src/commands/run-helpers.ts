/**
 * commands/run-helpers.ts — shared driver glue for the 11 analysis commands.
 *
 * Each command resolves its CWD, loads (or synthesises) a `FugaziConfig`, picks
 * a reporter via `selectReporter`, calls `runAnalysis`, drains issues into the
 * reporter, writes the final payload to stdout, and returns the exit code per
 * the spec (0 = no findings; 1 = error-severity findings present).
 *
 * Single-rule shortcuts (`unused-files`, `unused-exports`, `unused-types`,
 * `unused-deps`, `circular-deps`, `boundaries`) reuse this helper with a
 * `singleRules` override that flips every other rule to `'off'`. Determinism
 * (NFR-1): config is cloned only once; severity tables are frozen objects so
 * runAnalysis observes byte-identical input across invocations.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type FugaziConfig, FugaziConfigSchemaPermissive, loadJsonConfig } from '@fugazi/config';
import {
  type AnalysisMode,
  type Reporter,
  type ReporterFormat,
  runAnalysis,
  selectReporter,
} from '@fugazi/core';
import type { RuleId, Severity } from '@fugazi/types';

/** Hard-coded driver version (matches @fugazi/core CORE_VERSION until 3i). */
const CLI_VERSION = '0.0.0';

/** Every RuleId currently dispatched by the registry — kept in lock-step. */
const ALL_RULE_IDS: readonly RuleId[] = [
  'boundary-violations',
  'circular-dependencies',
  'code-duplication',
  'cognitive-complexity',
  'complexity-hotspot',
  'duplicate-exports',
  'private-type-leak',
  'unlisted-dependencies',
  'unresolved-imports',
  'unused-class-members',
  'unused-deps',
  'unused-dev-deps',
  'unused-enum-members',
  'unused-exports',
  'unused-files',
  'unused-optional-deps',
  'unused-types',
];

/**
 * Build a per-rule severity override that turns every rule `off` except those
 * listed in `keep`. Frozen for determinism.
 */
export function buildSingleRuleTable(
  keep: readonly RuleId[],
): Readonly<Partial<Record<RuleId, Severity>>> {
  const table: Partial<Record<RuleId, Severity>> = {};
  for (const id of ALL_RULE_IDS) {
    table[id] = keep.includes(id) ? 'error' : 'off';
  }
  return Object.freeze(table);
}

interface RunOptions {
  readonly mode: AnalysisMode;
  readonly format: ReporterFormat;
  readonly quiet: boolean;
  readonly projectRoot: string;
  readonly singleRules?: Readonly<Partial<Record<RuleId, Severity>>>;
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
  readonly ciPreset: boolean;
}

/**
 * Load `.fugazirc.json` from `projectRoot`, falling back to defaults when no
 * config file is present. Synthesises a permissive parse so the CLI works on
 * fresh checkouts that haven't run `fugazi init`.
 */
export async function loadFugaziConfig(projectRoot: string): Promise<FugaziConfig> {
  const candidate = join(projectRoot, '.fugazirc.json');
  let raw: unknown = {};
  if (existsSync(candidate)) {
    try {
      raw = await loadJsonConfig(candidate);
    } catch {
      raw = {};
    }
  }
  return FugaziConfigSchemaPermissive.parse(raw) as FugaziConfig;
}

/** Apply a single-rule override on top of the loaded config (frozen output). */
function withRuleOverride(
  config: FugaziConfig,
  override: Readonly<Partial<Record<RuleId, Severity>>> | undefined,
): FugaziConfig {
  if (override === undefined) return config;
  const merged: FugaziConfig = {
    ...config,
    rules: { ...config.rules, ...override },
  };
  return merged;
}

/**
 * Drive `runAnalysis`, drain issues into a `Reporter`, write `end()` to stdout,
 * and return the exit code. Used by every analysis command.
 */
export async function runAndReport(opts: RunOptions): Promise<number> {
  const cfg = withRuleOverride(await loadFugaziConfig(opts.projectRoot), opts.singleRules);
  const reporter: Reporter = selectReporter(opts.format);
  reporter.begin({
    mode: opts.mode,
    version: CLI_VERSION,
    projectRoot: opts.projectRoot,
  });

  const result = await runAnalysis({
    kind: opts.mode,
    config: cfg,
    projectRoot: opts.projectRoot,
    onProgress: (event) => {
      if (!opts.quiet) reporter.emitProgress(event);
    },
  });

  for (const issue of result.issues) {
    reporter.emit(issue);
  }

  // Phase 4e (T369): hand the reporter the post-analysis cross-language
  // metrics so the JSON serializer can surface `metrics.filesByLang` and
  // `metrics.parseErrors`. Other reporters ignore the patch (no behaviour
  // change for human / sarif / compact / markdown).
  reporter.updateMeta({
    filesByLang: {
      ts: result.metrics.filesByLang.ts,
      py: result.metrics.filesByLang.py,
    },
    parseErrors: {
      total: result.metrics.parseErrors.total,
      byLang: {
        ts: result.metrics.parseErrors.byLang.ts,
        py: result.metrics.parseErrors.byLang.py,
      },
    },
  });

  const payload = reporter.end();
  if (typeof payload === 'string') {
    opts.stdout.write(payload);
    if (!payload.endsWith('\n')) opts.stdout.write('\n');
  } else {
    opts.stdout.write(payload);
  }

  // CI preset forces non-zero on any finding regardless of severity.
  if (opts.ciPreset && result.issues.length > 0) return 1;
  return result.issues.some((i) => i.severity === 'error') ? 1 : 0;
}
