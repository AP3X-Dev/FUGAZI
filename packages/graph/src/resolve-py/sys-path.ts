/**
 * resolve-py/sys-path.ts — Phase 4b T317 + T319 — sys.path-based resolver.
 *
 * For absolute imports like `import foo.bar.baz` or `from foo.bar import x`,
 * walk a fixed list of candidate "sys.path" roots, probing each for a match.
 *
 * Candidate root order (deterministic):
 *   1. `<projectRoot>`
 *   2. `<projectRoot>/src`  (only if it exists as a directory)
 *
 * For each root R and dotted module `foo.bar.baz`, probe in this order:
 *   1. `R/foo/bar/baz.py`
 *   2. `R/foo/bar/baz/__init__.py`
 *   3. `R/foo/bar/baz.pyi`         (stub file fallback)
 *
 * **Namespace packages (PEP 420, T319)**: Intermediate path components
 * (`R/foo/`, `R/foo/bar/`) are NOT required to contain `__init__.py`. A directory
 * without `__init__.py` is still a package per PEP 420. The probe strategy
 * above naturally supports this — the leaf module file is what we require, not
 * the chain of `__init__.py` files leading to it.
 *
 * Determinism notes:
 *   - Roots are probed in fixed order.
 *   - Within a root, probe order is the literal list above.
 *   - First hit wins; no enumeration of candidate names happens.
 *   - No filesystem listing is performed — the resolver only stats specific
 *     candidate paths.
 */

import type { FsAdapter } from '../resolve/fs-adapter.js';
import { joinPosix } from '../resolve/path-utils.js';

/**
 * Build the deterministic list of candidate sys.path roots for `projectRoot`.
 *
 * `<projectRoot>` is always first; `<projectRoot>/src` is appended only if it
 * exists as a directory at lookup time.
 */
export function buildSysPathRoots(projectRoot: string, fs: FsAdapter): readonly string[] {
  const roots: string[] = [projectRoot];
  const srcDir = joinPosix(projectRoot, 'src');
  if (fs.isDirectorySync(srcDir)) roots.push(srcDir);
  return roots;
}

/**
 * Resolve a dotted absolute Python module specifier.
 *
 * @param specifier  Dotted module path (e.g. `'foo'`, `'foo.bar.baz'`). Must
 *                   not start with `.` (relative imports are handled elsewhere).
 * @param projectRoot Absolute POSIX path to the project root.
 * @param fs         Filesystem adapter.
 * @returns          Resolved POSIX file path, or `null` on miss.
 */
export function resolveSysPath(
  specifier: string,
  projectRoot: string,
  fs: FsAdapter,
): string | null {
  if (specifier === '' || specifier.startsWith('.')) return null;
  const segments = specifier.split('.');
  if (segments.some((s) => s === '')) return null;

  const roots = buildSysPathRoots(projectRoot, fs);
  for (const root of roots) {
    const hit = probeRoot(root, segments, fs);
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * Probe a single sys.path root for a dotted module. Returns the resolved
 * file path or `null`.
 */
function probeRoot(root: string, segments: readonly string[], fs: FsAdapter): string | null {
  // Build the directory path from all-but-last segments, then probe the leaf
  // as a module file or as a package directory's __init__.
  let base = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    base = joinPosix(base, segments[i] ?? '');
  }
  const leaf = segments[segments.length - 1] ?? '';

  // 1. <base>/<leaf>.py — leaf is a module.
  const pyFile = joinPosix(base, `${leaf}.py`);
  if (fs.existsSync(pyFile) && !fs.isDirectorySync(pyFile)) return pyFile;

  // 2. <base>/<leaf>/__init__.py — leaf is a regular package.
  const initFile = joinPosix(joinPosix(base, leaf), '__init__.py');
  if (fs.existsSync(initFile) && !fs.isDirectorySync(initFile)) return initFile;

  // 3. <base>/<leaf>.pyi — type stub fallback.
  const pyiFile = joinPosix(base, `${leaf}.pyi`);
  if (fs.existsSync(pyiFile) && !fs.isDirectorySync(pyiFile)) return pyiFile;

  // 4. PEP 420 namespace package: <base>/<leaf>/ exists as a directory but
  //    has no __init__.py. The dispatcher's caller may want to know — but for
  //    a single-segment lookup there's no inner module to resolve to, so a
  //    bare namespace dir is unresolved (no concrete file). For multi-segment
  //    lookups this branch is not reached — we descend into segments[0..-2]
  //    above without requiring their __init__.py files, which is exactly the
  //    PEP 420 behavior.

  return null;
}
