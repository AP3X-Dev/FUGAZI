/**
 * rules/import-hygiene.ts — Phase 3f.2 Wave 2 (T148).
 *
 * Three rules share one walker:
 *
 *   - `unresolved-imports`     — import whose specifier didn't resolve to any
 *                                 file on disk OR resolves to a missing
 *                                 third-party package.
 *   - `unlisted-dependencies`  — import of a bare package that is NOT listed
 *                                 in any of `dependencies`,
 *                                 `devDependencies`, `optionalDependencies`,
 *                                 `peerDependencies`.
 *   - `duplicate-exports`      — same export `name` declared more than once
 *                                 in a single file (after filtering out
 *                                 css-class declarations).
 *
 * Walker pipeline:
 *
 *   1. Read `<projectRoot>/package.json` (best-effort — on parse error or
 *      missing file, the manifest is treated as empty: every bare import
 *      becomes `unlisted-dependencies`).
 *   2. For every Edge with `to === ROOT_FILE_ID && resolvable === false`:
 *        - If the specifier is bare and the bare package name is NOT in any
 *          declared section → `unlisted-dependencies` candidate.
 *        - Else (declared but missing on disk, or a relative/absolute path
 *          that didn't resolve) → `unresolved-imports` candidate.
 *   3. For every FileNode, group exported declarations by name (skipping
 *      `css-class`). Any group with `length > 1` → one `duplicate-exports`
 *      candidate with all occurrences.
 *
 * Memoization:
 *
 *   The registry calls all three factories on the same RuleContext; the
 *   WeakMap caches a SEVERITY-FREE candidate set so the package.json read +
 *   graph + inventory walks happen once per run. Each rule wraps its slice
 *   in the discriminated-issue shape with its own configured severity at
 *   emit time.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DiscriminatedIssue,
  DuplicateExportsIssue,
  Range,
  Severity,
  UnlistedDependenciesIssue,
  UnresolvedImportsIssue,
} from '@fugazi/types';
import { ROOT_FILE_ID } from '@fugazi/types';
import type { RuleContext, RuleHandler } from './types.js';

const UNRESOLVED_KIND = 'unresolved-imports' as const;
const UNLISTED_KIND = 'unlisted-dependencies' as const;
const DUP_EXPORT_KIND = 'duplicate-exports' as const;

interface UnresolvedCandidate {
  readonly file: string;
  readonly range: Range;
  readonly specifier: string;
}

interface UnlistedCandidate {
  readonly file: string;
  readonly range: Range;
  readonly specifier: string;
}

interface DuplicateExportCandidate {
  readonly file: string;
  readonly range: Range;
  readonly exportName: string;
  readonly occurrences: readonly { readonly file: string; readonly range: Range }[];
  readonly count: number;
}

interface ImportHygieneCandidates {
  readonly unresolved: readonly UnresolvedCandidate[];
  readonly unlisted: readonly UnlistedCandidate[];
  readonly duplicates: readonly DuplicateExportCandidate[];
}

const cache = new WeakMap<RuleContext, ImportHygieneCandidates>();

function collectCandidates(ctx: RuleContext): ImportHygieneCandidates {
  const hit = cache.get(ctx);
  if (hit !== undefined) return hit;

  const declaredPackages = readDeclaredPackages(ctx.projectRoot);

  const unresolved: UnresolvedCandidate[] = [];
  const unlisted: UnlistedCandidate[] = [];
  const idToPath = new Map<number, string>();
  for (const node of ctx.graph.files.values()) {
    idToPath.set(node.id as unknown as number, node.path);
  }

  for (const edge of ctx.graph.edges) {
    if (edge.to !== ROOT_FILE_ID) continue;
    if (edge.resolvable) continue;
    const fromPath = idToPath.get(edge.from as unknown as number);
    if (fromPath === undefined) continue;

    const bare = bareSpecifierToPackageName(edge.specifier);
    if (bare !== undefined) {
      if (!declaredPackages.has(bare)) {
        unlisted.push({ file: fromPath, range: edge.loc, specifier: edge.specifier });
      } else {
        unresolved.push({ file: fromPath, range: edge.loc, specifier: edge.specifier });
      }
    } else {
      unresolved.push({ file: fromPath, range: edge.loc, specifier: edge.specifier });
    }
  }
  unresolved.sort(byFileThenOffset);
  unlisted.sort(byFileThenOffset);

  const duplicates: DuplicateExportCandidate[] = [];
  for (const node of ctx.graph.files.values()) {
    const groups = new Map<string, { readonly file: string; readonly range: Range }[]>();
    for (const decl of node.inventory.declarations) {
      if (!decl.exported) continue;
      if (decl.kind === 'css-class') continue;
      let bucket = groups.get(decl.name);
      if (bucket === undefined) {
        bucket = [];
        groups.set(decl.name, bucket);
      }
      bucket.push({ file: node.path, range: decl.range });
    }
    const names = [...groups.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const name of names) {
      const occurrences = groups.get(name);
      if (occurrences === undefined || occurrences.length < 2) continue;
      const sortedOccs = [...occurrences].sort(byFileThenOffset);
      const first = sortedOccs[0];
      if (first === undefined) continue;
      duplicates.push({
        file: node.path,
        range: first.range,
        exportName: name,
        occurrences: Object.freeze(sortedOccs.map((o) => Object.freeze({ ...o }))),
        count: occurrences.length,
      });
    }
  }
  duplicates.sort(byFileThenOffset);

  const result: ImportHygieneCandidates = Object.freeze({
    unresolved: Object.freeze(unresolved),
    unlisted: Object.freeze(unlisted),
    duplicates: Object.freeze(duplicates),
  });
  cache.set(ctx, result);
  return result;
}

function byFileThenOffset(
  a: { file: string; range: Range },
  b: { file: string; range: Range },
): number {
  if (a.file < b.file) return -1;
  if (a.file > b.file) return 1;
  return a.range.start.byteOffset - b.range.start.byteOffset;
}

function readDeclaredPackages(projectRoot: string): ReadonlySet<string> {
  const out = new Set<string>();
  const manifestPath = join(projectRoot, 'package.json');
  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch {
    return out;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (parsed === null || typeof parsed !== 'object') return out;
  const m = parsed as Record<string, unknown>;
  for (const section of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    const v = m[section];
    if (v !== null && typeof v === 'object') {
      for (const name of Object.keys(v as Record<string, unknown>)) out.add(name);
    }
  }
  return out;
}

function bareSpecifierToPackageName(specifier: string): string | undefined {
  if (specifier.length === 0) return undefined;
  if (specifier.startsWith('./') || specifier.startsWith('../')) return undefined;
  if (specifier.startsWith('/')) return undefined;
  const colon = specifier.indexOf(':');
  const slash = specifier.indexOf('/');
  if (colon !== -1 && (slash === -1 || colon < slash)) return undefined;
  if (specifier.startsWith('@')) {
    const firstSlash = specifier.indexOf('/');
    if (firstSlash === -1) return undefined;
    const secondSlash = specifier.indexOf('/', firstSlash + 1);
    return secondSlash === -1 ? specifier : specifier.slice(0, secondSlash);
  }
  return slash === -1 ? specifier : specifier.slice(0, slash);
}

export function createUnresolvedImportsRule(severity: Severity): RuleHandler {
  return (ctx) => {
    const out: UnresolvedImportsIssue[] = [];
    for (const c of collectCandidates(ctx).unresolved) {
      out.push(
        Object.freeze({
          kind: UNRESOLVED_KIND,
          severity,
          file: c.file,
          range: c.range,
          specifier: c.specifier,
          message: `unresolved-imports: cannot resolve ${c.specifier} from ${c.file}`,
        }) satisfies UnresolvedImportsIssue,
      );
    }
    return out as readonly DiscriminatedIssue[];
  };
}

export function createUnlistedDependenciesRule(severity: Severity): RuleHandler {
  return (ctx) => {
    const out: UnlistedDependenciesIssue[] = [];
    for (const c of collectCandidates(ctx).unlisted) {
      out.push(
        Object.freeze({
          kind: UNLISTED_KIND,
          severity,
          file: c.file,
          range: c.range,
          specifier: c.specifier,
          message: `unlisted-dependencies: ${c.specifier} is not declared in package.json`,
        }) satisfies UnlistedDependenciesIssue,
      );
    }
    return out as readonly DiscriminatedIssue[];
  };
}

export function createDuplicateExportsRule(severity: Severity): RuleHandler {
  return (ctx) => {
    const out: DuplicateExportsIssue[] = [];
    for (const c of collectCandidates(ctx).duplicates) {
      out.push(
        Object.freeze({
          kind: DUP_EXPORT_KIND,
          severity,
          file: c.file,
          range: c.range,
          occurrences: c.occurrences,
          exportName: c.exportName,
          message: `duplicate-exports: ${c.exportName} declared ${c.count} times in ${c.file}`,
        }) satisfies DuplicateExportsIssue,
      );
    }
    return out as readonly DiscriminatedIssue[];
  };
}

// Test-only escape hatch — see unused-deps.ts for rationale.
export function __clearImportHygieneCacheForTest(ctx: RuleContext): void {
  cache.delete(ctx);
}
