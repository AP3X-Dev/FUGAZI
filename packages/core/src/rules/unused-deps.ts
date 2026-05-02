/**
 * rules/unused-deps.ts — Phase 3f.2 Wave 2 (T142).
 *
 * Three rules share one walker:
 *
 *   - `unused-deps`           — `dependencies` declared but never imported.
 *   - `unused-dev-deps`       — `devDependencies` declared but never imported.
 *   - `unused-optional-deps`  — `optionalDependencies` declared but never
 *                                imported.
 *
 * The walker:
 *
 *   1. Reads `<projectRoot>/package.json` synchronously (`node:fs.readFileSync`).
 *      On missing file or parse error, returns three empty issue arrays —
 *      hostile-input policy: a rule that cannot evaluate silently emits
 *      nothing rather than aborting the run (NFR §13).
 *   2. Collects every imported bare-package name from `graph.edges`. An edge
 *      contributes when:
 *        - `to === ROOT_FILE_ID` AND `resolvable === false`
 *        - the specifier is bare (does NOT start with `./`, `../`, `/`, or
 *          `<scheme>:`)
 *      Bare package names are normalised: `'@scope/pkg/sub'` → `'@scope/pkg'`,
 *      `'pkg/sub'` → `'pkg'`.
 *   3. Diffs each declared section against the imported set; the section
 *      complement is the unused list, sorted ascending and emitted with the
 *      rule-appropriate prefix.
 *
 * Production-mode override (FR-E4):
 *
 *   When `config.production === true`, the dev-deps and optional-deps
 *   handlers short-circuit to `[]`. The user has flipped a switch saying
 *   "I'm building a production bundle — dev-only and optional packages are
 *   irrelevant." The registry's `severityFor` is the canonical "rule off"
 *   path; this in-handler short-circuit is the secondary safety net so even
 *   a misconfigured registry never surfaces these warnings under production.
 *
 * Memoization:
 *
 *   The registry calls all three factories on the same RuleContext; the
 *   WeakMap keyed on ctx caches the parsed/walked analysis so the
 *   package.json read + graph walk happen once per run, not three times.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DiscriminatedIssue,
  Severity,
  UnusedDepsIssue,
  UnusedDevDepsIssue,
  UnusedOptionalDepsIssue,
} from '@fugazi/types';
import { ROOT_FILE_ID } from '@fugazi/types';
import type { RuleContext, RuleHandler } from './types.js';

const DEPS_KIND = 'unused-deps' as const;
const DEV_DEPS_KIND = 'unused-dev-deps' as const;
const OPTIONAL_DEPS_KIND = 'unused-optional-deps' as const;

interface DepsAnalysis {
  readonly manifestPath: string;
  readonly unusedDeps: readonly string[];
  readonly unusedDevDeps: readonly string[];
  readonly unusedOptionalDeps: readonly string[];
}

const cache = new WeakMap<RuleContext, DepsAnalysis | null>();

function analyzeUnusedDeps(ctx: RuleContext): DepsAnalysis | null {
  const hit = cache.get(ctx);
  if (hit !== undefined) return hit;

  // Project root is absolute POSIX. node:path.join handles any platform.
  const manifestPath = toPosix(join(ctx.projectRoot, 'package.json'));
  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch {
    cache.set(ctx, null);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    cache.set(ctx, null);
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') {
    cache.set(ctx, null);
    return null;
  }
  const manifest = parsed as Record<string, unknown>;

  const declaredDeps = stringRecord(manifest.dependencies);
  const declaredDevDeps = stringRecord(manifest.devDependencies);
  const declaredOptionalDeps = stringRecord(manifest.optionalDependencies);

  // Build the imported-package set from the graph.
  const imported = new Set<string>();
  for (const edge of ctx.graph.edges) {
    if (edge.to !== ROOT_FILE_ID) continue;
    if (edge.resolvable) continue;
    const pkg = bareSpecifierToPackageName(edge.specifier);
    if (pkg === undefined) continue;
    imported.add(pkg);
  }

  const diff = (declared: readonly string[]): readonly string[] => {
    const out: string[] = [];
    for (const name of declared) {
      if (!imported.has(name)) out.push(name);
    }
    out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return out;
  };

  const result: DepsAnalysis = Object.freeze({
    manifestPath,
    unusedDeps: diff(declaredDeps),
    unusedDevDeps: diff(declaredDevDeps),
    unusedOptionalDeps: diff(declaredOptionalDeps),
  });
  cache.set(ctx, result);
  return result;
}

function stringRecord(v: unknown): readonly string[] {
  if (v === null || typeof v !== 'object') return [];
  // Map order in package.json is JSON-text order; sort ascending for
  // determinism — the analysis already re-sorts but keep the upstream stable.
  return Object.keys(v as Record<string, unknown>);
}

function bareSpecifierToPackageName(specifier: string): string | undefined {
  if (specifier.length === 0) return undefined;
  if (specifier.startsWith('./') || specifier.startsWith('../')) return undefined;
  if (specifier.startsWith('/')) return undefined;
  // Has a scheme like `node:` or `https:` — bail.
  const colon = specifier.indexOf(':');
  if (colon !== -1 && colon < specifier.indexOf('/')) return undefined;
  if (colon !== -1 && !specifier.includes('/')) return undefined;
  // Strip subpaths.
  if (specifier.startsWith('@')) {
    // Scoped: '@scope/pkg' or '@scope/pkg/sub'
    const firstSlash = specifier.indexOf('/');
    if (firstSlash === -1) return undefined; // '@scope' alone is invalid
    const secondSlash = specifier.indexOf('/', firstSlash + 1);
    return secondSlash === -1 ? specifier : specifier.slice(0, secondSlash);
  }
  const slash = specifier.indexOf('/');
  return slash === -1 ? specifier : specifier.slice(0, slash);
}

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

export function createUnusedDepsRule(severity: Severity): RuleHandler {
  return (ctx) => {
    const analysis = analyzeUnusedDeps(ctx);
    if (analysis === null) return [];
    const out: UnusedDepsIssue[] = [];
    for (const name of analysis.unusedDeps) {
      out.push(
        Object.freeze({
          kind: DEPS_KIND,
          severity,
          file: analysis.manifestPath,
          dependency: name,
          manifestPath: analysis.manifestPath,
          message: `unused-deps: package ${name} declared but not imported`,
        }) satisfies UnusedDepsIssue,
      );
    }
    return out as readonly DiscriminatedIssue[];
  };
}

export function createUnusedDevDepsRule(severity: Severity): RuleHandler {
  return (ctx) => {
    if (ctx.config.production === true) return [];
    const analysis = analyzeUnusedDeps(ctx);
    if (analysis === null) return [];
    const out: UnusedDevDepsIssue[] = [];
    for (const name of analysis.unusedDevDeps) {
      out.push(
        Object.freeze({
          kind: DEV_DEPS_KIND,
          severity,
          file: analysis.manifestPath,
          dependency: name,
          manifestPath: analysis.manifestPath,
          message: `unused-dev-deps: package ${name} declared but not imported`,
        }) satisfies UnusedDevDepsIssue,
      );
    }
    return out as readonly DiscriminatedIssue[];
  };
}

export function createUnusedOptionalDepsRule(severity: Severity): RuleHandler {
  return (ctx) => {
    if (ctx.config.production === true) return [];
    const analysis = analyzeUnusedDeps(ctx);
    if (analysis === null) return [];
    const out: UnusedOptionalDepsIssue[] = [];
    for (const name of analysis.unusedOptionalDeps) {
      out.push(
        Object.freeze({
          kind: OPTIONAL_DEPS_KIND,
          severity,
          file: analysis.manifestPath,
          dependency: name,
          manifestPath: analysis.manifestPath,
          message: `unused-optional-deps: package ${name} declared but not imported`,
        }) satisfies UnusedOptionalDepsIssue,
      );
    }
    return out as readonly DiscriminatedIssue[];
  };
}

// Test-only helper: clear the per-ctx memoisation between fixtures. Production
// callers reuse a RuleContext for the lifetime of one runAnalysis call, so the
// WeakMap is GC'd naturally; tests allocate many contexts and need an escape
// hatch when a test mutates a manifest between two analyze() calls on the same
// ctx (rare, but guarded against here).
export function __clearUnusedDepsCacheForTest(ctx: RuleContext): void {
  cache.delete(ctx);
}
