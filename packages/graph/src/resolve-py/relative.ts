/**
 * resolve-py/relative.ts — Phase 4b T318 — Python relative import resolver.
 *
 * Python relative imports are anchored to the importing file's package, NOT
 * to its directory. This is fundamentally different from JS-style relative
 * imports. The visitor encodes them in `Import.source` per the convention:
 *
 *   level=1, module=null     → '.'        (`from . import x`)
 *   level=1, module='foo'    → '.foo'     (`from .foo import x`)
 *   level=2, module=null     → '..'       (`from .. import x`)
 *   level=2, module='foo.bar'→ '..foo.bar`(`from ..foo.bar import x`)
 *   level=3, module=null     → '...'      (`from ... import x`)
 *
 * Resolution algorithm:
 *   1. Parse the specifier into (level, moduleParts).
 *   2. Find the importing file's package root (nearest `__init__.py` ancestor;
 *      if none, the file's own directory).
 *   3. Walk up `level - 1` directories from the importing file's parent
 *      directory. (Level 1 = same package, level 2 = parent package, …)
 *   4. From that anchor, resolve `moduleParts` like sys-path resolution.
 *
 * Edge cases:
 *   - File outside any package (no `__init__.py` ancestor): a single-dot
 *     relative still resolves against the file's own directory (Python rejects
 *     this at runtime, but the analyzer is permissive — it tries to find a
 *     concrete file and reports unresolved if not).
 *   - Over-dotting (more dots than directories above): unresolvable.
 *   - Bare `from . import x`: returns the package's `__init__.py` if present,
 *     since `x` is a name imported FROM the package, not a module path.
 */

import type { FsAdapter } from '../resolve/fs-adapter.js';
import { dirnamePosix, joinPosix, rootOfPosix } from '../resolve/path-utils.js';
import { findPackageRoot } from './namespace-pkg.js';

/**
 * Parse a relative-import source like `'.foo'`, `'..bar.baz'`, or `'...'`
 * into its dot count and module-part array.
 *
 * Returns `null` if the input is not a relative import (no leading dot).
 */
export function parseRelativeSpec(
  source: string,
): { readonly level: number; readonly parts: readonly string[] } | null {
  if (!source.startsWith('.')) return null;
  let level = 0;
  while (level < source.length && source[level] === '.') level += 1;
  const remainder = source.slice(level);
  if (remainder === '') return { level, parts: [] };
  const parts = remainder.split('.');
  if (parts.some((p) => p === '')) return { level, parts: [] };
  return { level, parts };
}

/**
 * Resolve a Python relative import.
 *
 * @param source    The encoded relative-import source (e.g. `'.foo'`).
 * @param fromFile  Absolute POSIX path of the importing file.
 * @param fs        Filesystem adapter.
 */
export function resolvePyRelative(source: string, fromFile: string, fs: FsAdapter): string | null {
  const parsed = parseRelativeSpec(source);
  if (parsed === null) return null;
  const { level, parts } = parsed;
  if (level < 1) return null;

  const fromDir = dirnamePosix(fromFile);
  if (fromDir === '') return null;
  const rootBoundary = rootOfPosix(fromDir) || '/';

  // Step 1: find the package root for the importing file.
  const pkgRoot = findPackageRoot(fromDir, fs);
  if (pkgRoot === null) return null;

  // Step 2: walk up `level - 1` directories from `fromDir`. Each step must
  // not escape past the filesystem root.
  let anchor = fromDir;
  for (let i = 0; i < level - 1; i += 1) {
    const parent = dirnamePosix(anchor);
    if (
      parent === anchor ||
      parent === '' ||
      (anchor === rootBoundary && parent === rootBoundary)
    ) {
      return null; // over-dotting
    }
    anchor = parent;
  }

  // Step 3: resolve `parts` relative to `anchor`.
  if (parts.length === 0) {
    // `from . import x` — return the package's __init__.py if present, since
    // we cannot disambiguate name `x` here. The graph layer treats this edge
    // as resolving to the package root.
    const init = joinPosix(anchor, '__init__.py');
    if (fs.existsSync(init) && !fs.isDirectorySync(init)) return init;
    const initPyi = joinPosix(anchor, '__init__.pyi');
    if (fs.existsSync(initPyi) && !fs.isDirectorySync(initPyi)) return initPyi;
    return null;
  }

  // Build the descend path.
  let base = anchor;
  for (let i = 0; i < parts.length - 1; i += 1) {
    base = joinPosix(base, parts[i] ?? '');
  }
  const leaf = parts[parts.length - 1] ?? '';

  // Probe order mirrors sys-path resolution.
  const pyFile = joinPosix(base, `${leaf}.py`);
  if (fs.existsSync(pyFile) && !fs.isDirectorySync(pyFile)) return pyFile;

  const initFile = joinPosix(joinPosix(base, leaf), '__init__.py');
  if (fs.existsSync(initFile) && !fs.isDirectorySync(initFile)) return initFile;

  const pyiFile = joinPosix(base, `${leaf}.pyi`);
  if (fs.existsSync(pyiFile) && !fs.isDirectorySync(pyiFile)) return pyiFile;

  // pkgRoot ref kept to make the dependency intentional.
  void pkgRoot;
  return null;
}
