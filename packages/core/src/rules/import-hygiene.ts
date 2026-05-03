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

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type PythonManifest,
  loadPythonManifest,
  nodeFsAdapter,
  normalizePackageName,
} from '@fugazi/graph';
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

  // Workspace-root declared packages — every file inherits these. In a
  // monorepo they include shared root devDependencies (vitest, biome, …).
  const rootDeclared = readDeclaredPackages(ctx.projectRoot);
  // Per-directory cache of declared package sets keyed by the package.json
  // directory. Avoids rereading & reparsing the manifest for every edge in
  // the same package.
  const declaredByPkgDir = new Map<string, ReadonlySet<string>>();
  // Per-file cache: map from importing file path to the merged declared set
  // (root ∪ nearest package.json). Avoids walking parent directories for
  // every edge from the same file.
  const declaredByFile = new Map<string, ReadonlySet<string>>();

  // Phase 4c T332: Python per-directory manifest cache. Keyed by the
  // manifest-containing directory; the value is the loaded `PythonManifest`.
  // The lookup walks parents from the importing file up to projectRoot
  // searching for any of the four canonical manifest filenames.
  const pyManifestByDir = new Map<string, PythonManifest>();
  // Per-file cache: importing file path → the resolved Python declared set.
  const pyDeclaredByFile = new Map<string, ReadonlySet<string>>();

  function declaredFor(filePath: string): ReadonlySet<string> {
    const cached = declaredByFile.get(filePath);
    if (cached !== undefined) return cached;
    const nearestDir = findNearestPackageJsonDir(filePath, ctx.projectRoot);
    let merged: ReadonlySet<string>;
    if (nearestDir === null || toPosix(nearestDir) === toPosix(ctx.projectRoot)) {
      // No nearer manifest, or the nearest IS the workspace root — root set
      // alone is the answer.
      merged = rootDeclared;
    } else {
      let pkgDeclared = declaredByPkgDir.get(nearestDir);
      if (pkgDeclared === undefined) {
        pkgDeclared = readDeclaredPackagesFromDir(nearestDir);
        declaredByPkgDir.set(nearestDir, pkgDeclared);
      }
      const union = new Set<string>(rootDeclared);
      for (const name of pkgDeclared) union.add(name);
      merged = union;
    }
    declaredByFile.set(filePath, merged);
    return merged;
  }

  /**
   * T332: resolve the declared-package set for a Python importing file by
   * walking from its directory up to `projectRoot` looking for any of the
   * canonical Python manifests (pyproject.toml, setup.cfg, setup.py,
   * requirements.txt). The first hit wins; missing manifest yields the
   * empty set (every bare import → unlisted).
   */
  function pyDeclaredFor(filePath: string): ReadonlySet<string> {
    const cached = pyDeclaredByFile.get(filePath);
    if (cached !== undefined) return cached;
    const dir = findNearestPyManifestDir(filePath, ctx.projectRoot);
    let manifest: PythonManifest;
    if (dir === null) {
      manifest = loadPyManifestCached(ctx.projectRoot, pyManifestByDir);
    } else {
      manifest = loadPyManifestCached(dir, pyManifestByDir);
    }
    const all = manifest.all;
    pyDeclaredByFile.set(filePath, all);
    return all;
  }

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

    if (isPythonFilePath(fromPath)) {
      const pyPkg = bareSpecifierToPyPackageName(edge.specifier);
      if (pyPkg !== undefined) {
        const declared = pyDeclaredFor(fromPath);
        if (!declared.has(pyPkg)) {
          unlisted.push({ file: fromPath, range: edge.loc, specifier: edge.specifier });
        } else {
          unresolved.push({ file: fromPath, range: edge.loc, specifier: edge.specifier });
        }
      } else {
        unresolved.push({ file: fromPath, range: edge.loc, specifier: edge.specifier });
      }
      continue;
    }

    const bare = bareSpecifierToPackageName(edge.specifier);
    if (bare !== undefined) {
      const declared = declaredFor(fromPath);
      if (!declared.has(bare)) {
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
  return readDeclaredPackagesFromDir(projectRoot);
}

/**
 * Read the four dep sections from `<dir>/package.json` PLUS the package's
 * own `name` field. The own name is included so a package can self-import
 * via its public name (`@scope/foo` from inside `@scope/foo/src/x.ts`)
 * without the rule reporting it as unlisted. Best-effort: missing file or
 * parse error returns an empty set.
 */
function readDeclaredPackagesFromDir(dir: string): ReadonlySet<string> {
  const out = new Set<string>();
  const manifestPath = join(dir, 'package.json');
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
  // Self-name: a package can always import itself by its public name.
  const ownName = m.name;
  if (typeof ownName === 'string' && ownName.length > 0) {
    out.add(ownName);
  }
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

/**
 * Walk parents of `dirname(filePath)` up to (but not past) `projectRoot`,
 * returning the first directory whose `package.json` exists. Returns the
 * `projectRoot` itself when no nearer manifest is found AND the root has
 * one. Returns `null` only when the path is not under `projectRoot`.
 *
 * Path comparisons normalize `\\` to `/` so Windows paths walk correctly.
 */
function findNearestPackageJsonDir(filePath: string, projectRoot: string): string | null {
  const root = toPosix(projectRoot);
  const start = toPosix(dirname(filePath));
  if (!start.startsWith(root)) return null;
  let cur = start;
  // Bound by projectRoot — never escape upward past it.
  while (cur.length >= root.length) {
    if (existsSync(join(cur, 'package.json'))) {
      return cur;
    }
    if (cur === root) break;
    const parent = toPosix(dirname(cur));
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

function toPosix(p: string): string {
  return p.split('\\').join('/');
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

/**
 * Phase 4c T332. Convert a Python import specifier (the dotted module path
 * recorded by the visitor) into the PEP 503-normalized package name a
 * Python manifest would declare. Returns `undefined` for relative imports
 * (`from . import x` is recorded with leading dots) and empty specifiers.
 *
 *   `urllib.request`        → 'urllib'
 *   `django.contrib.admin`  → 'django'
 *   `django_rest_framework` → 'django-rest-framework' (PEP 503)
 *   `numpy`                 → 'numpy'
 *   `.` / `..foo`           → undefined
 *   `''`                    → undefined
 */
export function bareSpecifierToPyPackageName(specifier: string): string | undefined {
  if (specifier.length === 0) return undefined;
  if (specifier.startsWith('.')) return undefined;
  // Skip URL-style or scheme-prefixed (defensive — Python imports can't
  // have these but the import edges share the same Edge.specifier shape).
  if (specifier.includes(':')) return undefined;
  const dot = specifier.indexOf('.');
  const leading = dot === -1 ? specifier : specifier.slice(0, dot);
  if (leading === '') return undefined;
  return normalizePackageName(leading);
}

/**
 * Phase 4c T332. Walk parents of `dirname(filePath)` up to (but not past)
 * `projectRoot`, returning the first directory containing any of the
 * canonical Python manifest filenames. Returns `null` when none is found
 * AND the path is not under `projectRoot`. When the path is under the root
 * but no manifest exists between, returns `null` so the caller falls back
 * to loading the project root.
 */
function findNearestPyManifestDir(filePath: string, projectRoot: string): string | null {
  const root = toPosix(projectRoot);
  const start = toPosix(dirname(filePath));
  if (!start.startsWith(root)) return null;
  const candidates: readonly string[] = [
    'pyproject.toml',
    'setup.cfg',
    'setup.py',
    'requirements.txt',
  ];
  let cur = start;
  while (cur.length >= root.length) {
    for (const name of candidates) {
      if (existsSync(join(cur, name))) {
        return cur;
      }
    }
    if (cur === root) break;
    const parent = toPosix(dirname(cur));
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

/**
 * Phase 4c T332. Cached wrapper around `loadPythonManifest` keyed by the
 * containing directory. The `loadPythonManifest` API is synchronous and
 * never throws — empty manifest is returned when nothing is found.
 */
function loadPyManifestCached(
  dir: string,
  cachedByDir: Map<string, PythonManifest>,
): PythonManifest {
  const cached = cachedByDir.get(dir);
  if (cached !== undefined) return cached;
  const manifest = loadPythonManifest(dir, nodeFsAdapter);
  cachedByDir.set(dir, manifest);
  return manifest;
}

function isPythonFilePath(path: string): boolean {
  return path.endsWith('.py');
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
      const manifest = isPythonFilePath(c.file) ? 'pyproject.toml' : 'package.json';
      out.push(
        Object.freeze({
          kind: UNLISTED_KIND,
          severity,
          file: c.file,
          range: c.range,
          specifier: c.specifier,
          message: `unlisted-dependencies: ${c.specifier} is not declared in ${manifest}`,
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
