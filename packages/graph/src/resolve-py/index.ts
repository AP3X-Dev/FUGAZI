/**
 * resolve-py/index.ts — Phase 4b — Python resolver barrel.
 *
 * Exposes the Python-specific resolver primitives. The dispatcher in
 * `../resolve/index.ts` consumes these. External callers can import the
 * primitives directly via `@fugazi/graph` for advanced use.
 */

export type { PythonManifest } from './manifest.js';
export {
  EMPTY_PYTHON_MANIFEST,
  extractRequirementName,
  loadPythonManifest,
  normalizePackageName,
} from './manifest.js';

export { loadPythonEntryPoints } from './entry-points.js';

export { findPackageRoot, isAnyPackage, isRegularPackage } from './namespace-pkg.js';

export { parseRelativeSpec, resolvePyRelative } from './relative.js';

export { PYTHON_STDLIB_MODULES, isPythonStdlib } from './stdlib.js';

export { buildSysPathRoots, resolveSysPath } from './sys-path.js';

export { findVirtualenv, resolveInVirtualenv } from './virtualenv.js';
