/**
 * infer-entrypoints.ts — zero-config entry-point inference.
 *
 * When a project declares no `entrypoints` in its config, the unused-* rules
 * have no reachability frame of reference: every file looks unreachable (so
 * the rules either over-report everything or, today, early-return and report
 * nothing). This module supplies a sensible default root set inferred from two
 * signals, so an unconfigured project still gets accurate dead-code results:
 *
 *   1. **Conventions** — well-known entry filenames/locations (e.g.
 *      `src/index.ts`, `**​/__main__.py`, test files, root config files),
 *      matched against the discovered file set.
 *   2. **Manifests** — declared entries that may live in non-conventional
 *      locations: `package.json` `bin`/`main`/`module`/`exports`, and
 *      `pyproject.toml` `[project.scripts]` / `[tool.poetry.scripts]` / etc.
 *      (resolved to source files by {@link loadPythonEntryPoints}).
 *
 * Every returned path is an absolute POSIX path that is present in `fileNodes`
 * — inference never invents a root for a file the analysis did not discover.
 * The result is sorted and de-duplicated for determinism. Inference is purely
 * additive: it can only make more files reachable, never fewer.
 */

import { type FileNode, type FsAdapter, loadPythonEntryPoints } from '@fugazi/graph';
import { matchesGlob } from '@fugazi/plugins';

/** Source extensions Fugazi analyses, used for extensionless manifest targets. */
const SOURCE_EXTS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'] as const;

/** Brace group of every JS/TS source extension, for convention globs. */
const JS = `{${SOURCE_EXTS.join(',')}}`;

/**
 * Convention entry-point globs, matched against each discovered file's
 * project-relative POSIX path. A file matching any pattern becomes a root.
 *
 * The set errs toward inclusion: marking a real entry as a root only risks
 * missing some dead code, whereas omitting one falsely reports live code as
 * dead — the far worse failure for trust.
 */
const CONVENTIONS: readonly string[] = [
  // ── JS/TS application & library entries ──────────────────────────────
  `index.${JS}`,
  `src/index.${JS}`,
  `main.${JS}`,
  `src/main.${JS}`,
  `cli.${JS}`,
  `src/cli.${JS}`,
  `server.${JS}`,
  `src/server.${JS}`,
  `app.${JS}`,
  `src/app.${JS}`,
  `bin/**/*.${JS}`,
  `src/bin/**/*.${JS}`,
  `scripts/**/*.${JS}`,
  // Electron main/preload/renderer conventions (non-import reachability).
  `**/preload.${JS}`,
  `src/electron/main.${JS}`,
  `src/main/index.${JS}`,
  `src/renderer/index.${JS}`,
  // Monorepo workspace package entries.
  `packages/*/src/index.${JS}`,
  `packages/*/index.${JS}`,
  `packages/*/src/main.${JS}`,
  // Test files are entries — invoked by the test runner, not imported.
  `**/*.test.${JS}`,
  `**/*.spec.${JS}`,
  `**/__tests__/**/*.${JS}`,
  `**/__mocks__/**/*.${JS}`,
  `test/**/*.${JS}`,
  `tests/**/*.${JS}`,
  // Root-level tooling config files are run by their tools.
  `*.config.${JS}`,

  // ── Python execution conventions ─────────────────────────────────────
  '**/__main__.py', // `python -m pkg`
  'manage.py', // Django
  '**/manage.py',
  'wsgi.py',
  'asgi.py',
  '**/wsgi.py',
  '**/asgi.py',
  'app.py',
  'main.py',
  'run.py',
  'src/main.py',
  'setup.py',
  'noxfile.py',
  'tasks.py',
  // pytest collects these directly.
  'conftest.py',
  '**/conftest.py',
  '**/test_*.py',
  '**/*_test.py',
  'test/**/*.py',
  'tests/**/*.py',
  'scripts/**/*.py',
];

/**
 * Infer entry-point roots for a project with no declared `entrypoints`.
 *
 * @param projectRoot Absolute POSIX project root.
 * @param fileNodes   Discovered file set keyed by absolute POSIX path.
 * @param fs          Filesystem adapter for manifest reads.
 * @returns           Sorted, de-duplicated absolute POSIX entry paths, each
 *                    guaranteed to be a key of `fileNodes`.
 */
export function inferEntryPoints(
  projectRoot: string,
  fileNodes: ReadonlyMap<string, FileNode>,
  fs: FsAdapter,
): readonly string[] {
  if (fileNodes.size === 0) return [];

  const rootPrefix = projectRoot.endsWith('/') ? projectRoot : `${projectRoot}/`;
  // Project-relative POSIX path → absolute POSIX path, for membership tests.
  const relToAbs = new Map<string, string>();
  for (const node of fileNodes.values()) {
    const rel = node.path.startsWith(rootPrefix) ? node.path.slice(rootPrefix.length) : node.path;
    relToAbs.set(rel, node.path);
  }

  const found = new Set<string>();

  // 1. Conventions — match every discovered file against the pattern set.
  for (const [rel, abs] of relToAbs) {
    for (const pattern of CONVENTIONS) {
      if (matchesGlob(pattern, rel)) {
        found.add(abs);
        break;
      }
    }
  }

  // 2. package.json manifest entries (bin / main / module / exports).
  for (const target of readPackageJsonTargets(projectRoot, fs)) {
    for (const rel of manifestCandidates(target)) {
      const abs = relToAbs.get(rel);
      if (abs !== undefined) found.add(abs);
    }
  }

  // 3. pyproject.toml declared entry points, already resolved to files.
  for (const abs of loadPythonEntryPoints(projectRoot, fs)) {
    if (fileNodes.has(abs)) found.add(abs);
  }

  return [...found].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Read raw `bin`/`main`/`module`/`exports` target strings from package.json. */
function readPackageJsonTargets(projectRoot: string, fs: FsAdapter): readonly string[] {
  const path = `${projectRoot.endsWith('/') ? projectRoot : `${projectRoot}/`}package.json`;
  let text: string;
  try {
    text = fs.readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const pkg = parsed as Record<string, unknown>;

  const out: string[] = [];
  if (typeof pkg.main === 'string') out.push(pkg.main);
  if (typeof pkg.module === 'string') out.push(pkg.module);

  // `bin` is either a single path or a { name: path } map.
  const bin = pkg.bin;
  if (typeof bin === 'string') {
    out.push(bin);
  } else if (typeof bin === 'object' && bin !== null && !Array.isArray(bin)) {
    for (const v of Object.values(bin as Record<string, unknown>)) {
      if (typeof v === 'string') out.push(v);
    }
  }

  // `exports` is a string, a conditions object, or a subpath map — collect
  // every string leaf.
  collectExportTargets(pkg.exports, out);

  return out;
}

/** Recursively collect every string leaf of a package.json `exports` value. */
function collectExportTargets(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
  } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectExportTargets(v, out);
    }
  }
}

/**
 * Candidate project-relative paths a manifest target may resolve to. A target
 * with a source extension resolves to itself; an extensionless target resolves
 * to `<target>.<ext>` or `<target>/index.<ext>`. Build-output targets (e.g.
 * `dist/index.js`) simply won't be present in the discovered source set and so
 * contribute nothing.
 */
function manifestCandidates(rawTarget: string): readonly string[] {
  // Normalise a leading `./` and any backslashes; ignore URL-ish / absolute.
  let target = rawTarget.replace(/\\/g, '/').trim();
  if (target.startsWith('./')) target = target.slice(2);
  if (target === '' || target.startsWith('/') || target.includes('://')) return [];

  const dot = target.lastIndexOf('.');
  const slash = target.lastIndexOf('/');
  const hasExt = dot > slash && dot !== -1;
  if (hasExt) {
    const ext = target.slice(dot + 1);
    return (SOURCE_EXTS as readonly string[]).includes(ext) ? [target] : [];
  }

  const out: string[] = [];
  for (const ext of SOURCE_EXTS) out.push(`${target}.${ext}`);
  for (const ext of SOURCE_EXTS) out.push(`${target}/index.${ext}`);
  return out;
}
