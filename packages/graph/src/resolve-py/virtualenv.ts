/**
 * resolve-py/virtualenv.ts — Phase 4b T320 — virtualenv / site-packages awareness.
 *
 * Detects a Python virtualenv at the project root and answers "is this
 * specifier installed there?" The dispatcher uses this together with the
 * manifest check to differentiate "external dependency declared and installed"
 * from "external dependency declared but missing".
 *
 * Detection order at `<projectRoot>`:
 *   1. `.venv/`
 *   2. `venv/`
 *   3. `env/`
 *   4. `.env/`
 *
 * The first existing directory wins. Once chosen, we look for a site-packages
 * subdirectory in two layouts:
 *
 *   - Windows:        `<venv>/Lib/site-packages`
 *   - POSIX (Linux/macOS): `<venv>/lib/python<major.minor>/site-packages` —
 *     since we don't know the Python version, we scan a fixed list of
 *     candidate version strings (3.8 through 3.13). First hit wins.
 *
 * If site-packages cannot be located, `findVirtualenv` returns `null`.
 *
 * The `resolveInVirtualenv` function probes site-packages for the leading
 * dotted segment of `specifier`. It returns the site-packages POSIX path of
 * the package (file or `__init__.py`) on success, `null` on miss.
 *
 * Determinism: the candidate venv list and python-version list are both
 * fixed and frozen.
 */

import type { FsAdapter } from '../resolve/fs-adapter.js';
import { joinPosix } from '../resolve/path-utils.js';

/**
 * Candidate virtualenv directory names to probe at the project root, in
 * priority order.
 */
const VENV_CANDIDATES: readonly string[] = Object.freeze(['.venv', 'venv', 'env', '.env']);

/**
 * Candidate python versions to probe under `<venv>/lib/`. Conservative range
 * for active Python 3.x versions through 2026.
 */
const PYTHON_VERSIONS: readonly string[] = Object.freeze([
  'python3.13',
  'python3.12',
  'python3.11',
  'python3.10',
  'python3.9',
  'python3.8',
]);

/**
 * Locate the virtualenv site-packages directory at `projectRoot`. Returns the
 * POSIX path to `site-packages/` or `null` if no venv is present (or its
 * site-packages cannot be located).
 */
export function findVirtualenv(projectRoot: string, fs: FsAdapter): string | null {
  for (const candidate of VENV_CANDIDATES) {
    const venvDir = joinPosix(projectRoot, candidate);
    if (!fs.isDirectorySync(venvDir)) continue;

    // Windows layout: <venv>/Lib/site-packages
    const winSp = joinPosix(joinPosix(venvDir, 'Lib'), 'site-packages');
    if (fs.isDirectorySync(winSp)) return winSp;

    // POSIX layout: <venv>/lib/python<X.Y>/site-packages — probe a fixed list.
    const libDir = joinPosix(venvDir, 'lib');
    if (fs.isDirectorySync(libDir)) {
      for (const ver of PYTHON_VERSIONS) {
        const sp = joinPosix(joinPosix(libDir, ver), 'site-packages');
        if (fs.isDirectorySync(sp)) return sp;
      }
    }

    // First venv that exists wins, even if site-packages can't be found —
    // returning null here ensures the dispatcher doesn't accidentally fall
    // through to a less-preferred venv.
    return null;
  }
  return null;
}

/**
 * Probe `sitePackages` for `specifier`. Resolution rules mirror Python's
 * import machinery for a specific package directory:
 *
 *   1. `<sp>/<head>.py`
 *   2. `<sp>/<head>/__init__.py`
 *   3. `<sp>/<head>/__init__.pyi`
 *   4. `<sp>/<head>.pyi`
 *
 * `<head>` is the leading dotted segment of `specifier` (so `numpy.linalg`
 * resolves to `<sp>/numpy/__init__.py` or `<sp>/numpy.py`).
 *
 * Returns the resolved POSIX path or `null`.
 */
export function resolveInVirtualenv(
  specifier: string,
  sitePackages: string,
  fs: FsAdapter,
): string | null {
  if (specifier === '' || specifier.startsWith('.')) return null;
  const dot = specifier.indexOf('.');
  const head = dot === -1 ? specifier : specifier.slice(0, dot);
  if (head === '') return null;

  const py = joinPosix(sitePackages, `${head}.py`);
  if (fs.existsSync(py) && !fs.isDirectorySync(py)) return py;

  const init = joinPosix(joinPosix(sitePackages, head), '__init__.py');
  if (fs.existsSync(init) && !fs.isDirectorySync(init)) return init;

  const initPyi = joinPosix(joinPosix(sitePackages, head), '__init__.pyi');
  if (fs.existsSync(initPyi) && !fs.isDirectorySync(initPyi)) return initPyi;

  const pyi = joinPosix(sitePackages, `${head}.pyi`);
  if (fs.existsSync(pyi) && !fs.isDirectorySync(pyi)) return pyi;

  return null;
}
