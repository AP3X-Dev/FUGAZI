/**
 * resolve-py/namespace-pkg.ts — Phase 4b T319 — PEP 420 namespace package helpers.
 *
 * PEP 420 (Python 3.3+) allows a directory without `__init__.py` to act as a
 * package. Submodule resolution falls through directory boundaries that lack
 * `__init__.py`.
 *
 * The bulk of namespace-package support is baked into `sys-path.ts` and
 * `relative.ts` directly: those resolvers do NOT require `__init__.py` along
 * the chain — only the leaf module file is required. This module exposes two
 * small helpers that the relative resolver uses to find the importing file's
 * "package root", and that tests use to assert PEP 420 behaviour.
 */

import type { FsAdapter } from '../resolve/fs-adapter.js';
import { dirnamePosix, joinPosix, rootOfPosix } from '../resolve/path-utils.js';

/**
 * Return `true` if `dir` looks like a regular Python package (has
 * `__init__.py` or `__init__.pyi`).
 */
export function isRegularPackage(dir: string, fs: FsAdapter): boolean {
  const initPy = joinPosix(dir, '__init__.py');
  if (fs.existsSync(initPy) && !fs.isDirectorySync(initPy)) return true;
  const initPyi = joinPosix(dir, '__init__.pyi');
  if (fs.existsSync(initPyi) && !fs.isDirectorySync(initPyi)) return true;
  return false;
}

/**
 * Return `true` if `dir` looks like a Python package — either regular (has
 * `__init__.py`) or PEP 420 namespace (any directory with at least one .py
 * descendant). For the resolver we only need the cheap version: any directory
 * that exists is treated as a potential namespace package, since the leaf
 * file is what really matters. So this just returns whether the directory
 * exists. Callers that want to distinguish regular vs namespace use
 * `isRegularPackage`.
 */
export function isAnyPackage(dir: string, fs: FsAdapter): boolean {
  return fs.isDirectorySync(dir);
}

/**
 * Walk upward from `fromDir` and return the highest ancestor directory that
 * forms a package chain — i.e., the root of the package containing `fromDir`.
 * The walk stops at the first ancestor that is NOT a package (regular or
 * namespace) AND below which no package exists.
 *
 * For relative-import anchoring, the rule is:
 *
 *   - If `fromDir` itself contains `__init__.py`, it IS a package.
 *   - Walk up: keep going as long as the ancestor is a regular package
 *     (`__init__.py`) OR a directory that contains a regular package.
 *   - The package root is the topmost directory still considered "inside the
 *     package" — i.e., the ancestor whose parent is NOT a package.
 *
 * For PEP 420 (namespace) packages: the chain may include directories without
 * `__init__.py` as long as some descendant has one. For simplicity we use the
 * weaker rule: walk up while the parent is a directory and contains an
 * `__init__.py` OR a sibling that is itself a regular package — but that's
 * expensive. The more practical rule (used here) is:
 *
 *   - Walk up while `current/__init__.py` exists.
 *   - Stop at the highest dir that has `__init__.py`.
 *
 * For namespace-package files (no `__init__.py` ancestors), this returns the
 * file's own directory — which is the correct anchor for `from . import x`.
 *
 * Returns the package root POSIX path, or `null` if no package can be found
 * (the file is at the filesystem root).
 */
export function findPackageRoot(fromDir: string, fs: FsAdapter): string | null {
  if (fromDir === '') return null;
  const rootBoundary = rootOfPosix(fromDir) || '/';
  // Phase 1: identify whether the file is in a regular package.
  if (!isRegularPackage(fromDir, fs)) {
    // No __init__.py here — treat the file as living in a top-level (or
    // PEP 420 namespace) location. The package root is the file's own dir.
    return fromDir;
  }
  // Phase 2: walk up while the parent is also a regular package.
  let current = fromDir;
  for (let i = 0; i < 64; i += 1) {
    const parent = dirnamePosix(current);
    if (parent === current || parent === '' || parent === rootBoundary) {
      return current;
    }
    if (!isRegularPackage(parent, fs)) {
      // `current` is the topmost regular-package ancestor.
      return current;
    }
    current = parent;
  }
  return current;
}
