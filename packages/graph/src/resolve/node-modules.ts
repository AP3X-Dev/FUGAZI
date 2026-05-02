/**
 * node-modules.ts — T085 / T086 — bare-specifier resolver.
 *
 * Walks up from the importing file's directory, probing each ancestor's
 * `node_modules/<package>` for a match. For each candidate package this
 * module:
 *
 *   1. Reads `<pkg>/package.json` (cached).
 *   2. Computes the subpath: `'.'` for `react`, `'./useStuff'` for
 *      `react/useStuff`.
 *   3. Tries `exports` resolution first (Node's spec).
 *   4. Falls back to `main` / `module` for the package root.
 *   5. For deep imports without a matching `exports` entry, resolves the
 *      subpath relative to the package root and probes with the standard
 *      extension list.
 *
 * Scoped packages (`@scope/name`) are split correctly. The walk stops at
 * the filesystem root.
 */

import { DEFAULT_CONDITIONS, resolveExports } from './exports-conditions.js';
import type { FsAdapter } from './fs-adapter.js';
import { readPackageJson } from './package-json.js';
import { dirnamePosix, joinPosix, rootOfPosix } from './path-utils.js';
import { RELATIVE_EXTENSIONS } from './relative.js';

/**
 * Split a bare specifier into a package name and a subpath. Subpath is
 * `'.'` when the specifier is the bare package itself.
 *
 *   `react`          -> `{ name: 'react', subpath: '.' }`
 *   `react/useFoo`   -> `{ name: 'react', subpath: './useFoo' }`
 *   `@scope/pkg`     -> `{ name: '@scope/pkg', subpath: '.' }`
 *   `@scope/pkg/x`   -> `{ name: '@scope/pkg', subpath: './x' }`
 */
export function splitBareSpecifier(specifier: string): { name: string; subpath: string } {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    if (parts.length < 2) return { name: specifier, subpath: '.' };
    const name = `${parts[0]}/${parts[1]}`;
    if (parts.length === 2) return { name, subpath: '.' };
    return { name, subpath: `./${parts.slice(2).join('/')}` };
  }
  const slash = specifier.indexOf('/');
  if (slash === -1) return { name: specifier, subpath: '.' };
  const name = specifier.slice(0, slash);
  const subpath = `./${specifier.slice(slash + 1)}`;
  return { name, subpath };
}

function probeWithExtensions(target: string, fs: FsAdapter): string | null {
  for (const ext of RELATIVE_EXTENSIONS) {
    if (target.endsWith(ext)) {
      return fs.existsSync(target) && !fs.isDirectorySync(target) ? target : null;
    }
  }
  if (target.endsWith('.json') || target.endsWith('.mjs') || target.endsWith('.cjs')) {
    return fs.existsSync(target) && !fs.isDirectorySync(target) ? target : null;
  }
  // Direct file hit (some packages publish exact paths with no extension).
  if (fs.existsSync(target) && !fs.isDirectorySync(target)) return target;
  // Extension probing.
  for (const ext of RELATIVE_EXTENSIONS) {
    const probe = `${target}${ext}`;
    if (fs.existsSync(probe) && !fs.isDirectorySync(probe)) return probe;
  }
  // Directory index.
  if (fs.isDirectorySync(target)) {
    for (const ext of RELATIVE_EXTENSIONS) {
      const probe = joinPosix(target, `index${ext}`);
      if (fs.existsSync(probe) && !fs.isDirectorySync(probe)) return probe;
    }
    // `index.json` as last resort.
    const indexJson = joinPosix(target, 'index.json');
    if (fs.existsSync(indexJson) && !fs.isDirectorySync(indexJson)) return indexJson;
  }
  return null;
}

/**
 * Try every ancestor `node_modules/<name>` directory. Returns the package
 * root POSIX path or `null` if not found.
 */
function findPackageRoot(name: string, fromFile: string, fs: FsAdapter): string | null {
  const startDir = dirnamePosix(fromFile);
  const root = rootOfPosix(startDir) || '/';
  let current = startDir;
  for (let i = 0; i < 64; i += 1) {
    const candidate = joinPosix(joinPosix(current, 'node_modules'), name);
    if (fs.isDirectorySync(candidate)) return candidate;
    if (current === root || current === '') break;
    const parent = dirnamePosix(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Resolve a bare specifier through `node_modules` lookup. Returns the
 * resolved POSIX file path or `null` on miss.
 *
 * @param specifier  Bare specifier (e.g. `react`, `@scope/pkg/sub`).
 * @param fromFile   POSIX path of the importing file.
 * @param conditions Active export condition order. Defaults to
 *                   `DEFAULT_CONDITIONS` when omitted.
 * @param fs         Filesystem adapter.
 */
export function resolveNodeModules(
  specifier: string,
  fromFile: string,
  conditions: readonly string[] | undefined,
  fs: FsAdapter,
): string | null {
  const { name, subpath } = splitBareSpecifier(specifier);
  const pkgRoot = findPackageRoot(name, fromFile, fs);
  if (pkgRoot === null) return null;

  const pkgJsonPath = joinPosix(pkgRoot, 'package.json');
  const pkg = readPackageJson(pkgJsonPath, fs);
  const activeConditions = conditions ?? DEFAULT_CONDITIONS;

  // 1. exports field takes precedence.
  if (pkg !== null && pkg.exports !== undefined) {
    const mapped = resolveExports(pkg.exports, subpath, activeConditions);
    if (mapped !== null) {
      const target = joinPosix(pkgRoot, mapped);
      const hit = probeWithExtensions(target, fs);
      if (hit !== null) return hit;
    }
    // Fall through: a missing exports entry is NOT a hard miss for deep
    // imports — many older packages publish files outside their declared
    // exports map and rely on Node's permissive deep-import behavior.
  }

  // 2. main / module fallback for the package root.
  if (subpath === '.' || subpath === './') {
    if (pkg !== null) {
      // Prefer `module` (ESM) over `main` (CJS) when both are present.
      const candidateMain = pkg.module ?? pkg.main;
      if (candidateMain !== undefined) {
        const target = joinPosix(pkgRoot, candidateMain);
        const hit = probeWithExtensions(target, fs);
        if (hit !== null) return hit;
      }
    }
    // Last-resort: `index.<ext>` at package root.
    return probeWithExtensions(pkgRoot, fs);
  }

  // 3. Deep import: resolve subpath relative to package root and probe.
  const target = joinPosix(pkgRoot, subpath);
  return probeWithExtensions(target, fs);
}

/**
 * Test-only: clear caches.
 */
export { __clearPackageJsonCacheForTest } from './package-json.js';
