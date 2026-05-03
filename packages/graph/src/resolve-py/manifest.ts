/**
 * resolve-py/manifest.ts — Phase 4b T316 — Python manifest parser.
 *
 * Reads declared dependencies from any of (precedence order, first wins):
 *
 *   1. pyproject.toml
 *      - PEP 621: `[project.dependencies]` (runtime), `[project.optional-dependencies]` (optional)
 *      - Poetry: `[tool.poetry.dependencies]` (runtime, keys = pkg names),
 *                `[tool.poetry.dev-dependencies]` (dev),
 *                `[tool.poetry.group.<name>.dependencies]` (dev)
 *      - uv: `[tool.uv]` / `[tool.uv.sources]` (best-effort; uv mostly mirrors PEP 621)
 *   2. setup.cfg
 *      - `[options]` `install_requires` (runtime; one PEP 508 string per line)
 *      - `[options.extras_require]` (groups → optional/dev)
 *   3. setup.py
 *      - Best-effort regex extraction of literal `install_requires=[...]`. Non-literal
 *        forms (variable references, function calls) are silently skipped — documented
 *        as a v1 limitation. We do NOT execute the script.
 *   4. requirements*.txt
 *      - Line-by-line. Strips comments, URL-form requirements (`-e`, `git+`, `http(s)://`),
 *        and version specs.
 *
 * Package-name normalization follows PEP 503: lowercased and runs of `_`/`-`/`.`
 * collapsed to single `-`. So `Django-REST-Framework`, `django_rest_framework`, and
 * `django.rest.framework` all canonicalize to `django-rest-framework`.
 *
 * Contract:
 *   - Synchronous, never throws on parse failure (returns the empty manifest with
 *     `source: 'none'`). The caller decides what to do with an empty manifest.
 *   - Returned sets are frozen.
 *   - PEP 508 specifier parsing extracts only the package name. Version constraints,
 *     environment markers, and extras are dropped. E.g. `django>=4.0,<5.0` → `django`,
 *     `numpy[extra1,extra2]>=1.20` → `numpy`, `requests; python_version<"3.10"` →
 *     `requests`.
 */

import { parse as parseToml } from 'smol-toml';
import type { FsAdapter } from '../resolve/fs-adapter.js';
import { joinPosix } from '../resolve/path-utils.js';

export interface PythonManifest {
  /** Runtime dependencies (`project.dependencies`, `tool.poetry.dependencies`, …). */
  readonly runtime: ReadonlySet<string>;
  /** Dev / test / optional / extras dependencies. Includes everything in `optional`. */
  readonly dev: ReadonlySet<string>;
  /** PEP 621 `[project.optional-dependencies]` entries (also present in `dev`). */
  readonly optional: ReadonlySet<string>;
  /** Union of `runtime ∪ dev` for fast lookup. */
  readonly all: ReadonlySet<string>;
  /** Which file contributed the result. `'none'` means nothing was found. */
  readonly source: 'pyproject' | 'setup-cfg' | 'setup-py' | 'requirements' | 'none';
}

/**
 * Empty manifest singleton. Used as the "nothing was found" sentinel.
 */
export const EMPTY_PYTHON_MANIFEST: PythonManifest = Object.freeze({
  runtime: Object.freeze(new Set<string>()) as ReadonlySet<string>,
  dev: Object.freeze(new Set<string>()) as ReadonlySet<string>,
  optional: Object.freeze(new Set<string>()) as ReadonlySet<string>,
  all: Object.freeze(new Set<string>()) as ReadonlySet<string>,
  source: 'none',
});

/**
 * PEP 503 normalize a package name: lowercase, collapse runs of `[-_.]+` to a
 * single `-`. `Django-REST-Framework` → `django-rest-framework`.
 */
export function normalizePackageName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[-_.]+/g, '-');
}

/**
 * Extract just the package name from a PEP 508 requirement string.
 *
 *   `django>=4.0,<5.0`                → `django`
 *   `numpy[extra1,extra2]>=1.20`      → `numpy`
 *   `requests; python_version<"3.10"` → `requests`
 *   `package-name`                     → `package-name`
 *   `   spaced  `                      → `spaced`
 *
 * Returns `''` if the input is empty or starts with a non-name character (e.g.
 * a URL like `git+https://...`).
 */
export function extractRequirementName(spec: string): string {
  const trimmed = spec.trim();
  if (trimmed === '') return '';
  // Match leading identifier: letter/digit, then letters/digits/dots/hyphens/underscores.
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(trimmed);
  if (m === null) return '';
  return normalizePackageName(m[1] ?? '');
}

/**
 * Parse a list of PEP 508 strings into a normalized name set.
 */
function parsePep508List(items: readonly unknown[]): Set<string> {
  const out = new Set<string>();
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const name = extractRequirementName(item);
    if (name !== '') out.add(name);
  }
  return out;
}

/**
 * Try to read and parse pyproject.toml. Returns `null` if the file is absent
 * or unparseable.
 */
function tryReadPyproject(
  path: string,
  fs: FsAdapter,
): {
  runtime: Set<string>;
  dev: Set<string>;
  optional: Set<string>;
} | null {
  if (!fs.existsSync(path) || fs.isDirectorySync(path)) return null;
  let text: string;
  try {
    text = fs.readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = parseToml(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const runtime = new Set<string>();
  const dev = new Set<string>();
  const optional = new Set<string>();

  const obj = parsed as Record<string, unknown>;

  // ── PEP 621: [project] ─────────────────────────────────────────────────
  const project = obj.project;
  if (typeof project === 'object' && project !== null) {
    const projObj = project as Record<string, unknown>;
    const deps = projObj.dependencies;
    if (Array.isArray(deps)) {
      for (const name of parsePep508List(deps)) runtime.add(name);
    }
    const optDeps = projObj['optional-dependencies'];
    if (typeof optDeps === 'object' && optDeps !== null && !Array.isArray(optDeps)) {
      for (const list of Object.values(optDeps as Record<string, unknown>)) {
        if (Array.isArray(list)) {
          for (const name of parsePep508List(list)) {
            optional.add(name);
            dev.add(name);
          }
        }
      }
    }
  }

  // ── Poetry: [tool.poetry.*] ────────────────────────────────────────────
  const tool = obj.tool;
  if (typeof tool === 'object' && tool !== null) {
    const toolObj = tool as Record<string, unknown>;

    const poetry = toolObj.poetry;
    if (typeof poetry === 'object' && poetry !== null) {
      const poetryObj = poetry as Record<string, unknown>;
      // Runtime deps (keys are package names; values are version specs or
      // tables — we ignore values, just take the key).
      const pdeps = poetryObj.dependencies;
      if (typeof pdeps === 'object' && pdeps !== null && !Array.isArray(pdeps)) {
        for (const key of Object.keys(pdeps as Record<string, unknown>)) {
          // Poetry has a special `python` key for the Python version itself —
          // skip it.
          if (key === 'python') continue;
          const norm = normalizePackageName(key);
          if (norm !== '') runtime.add(norm);
        }
      }
      // Legacy dev-dependencies key (Poetry < 1.2).
      const pdev = poetryObj['dev-dependencies'];
      if (typeof pdev === 'object' && pdev !== null && !Array.isArray(pdev)) {
        for (const key of Object.keys(pdev as Record<string, unknown>)) {
          if (key === 'python') continue;
          const norm = normalizePackageName(key);
          if (norm !== '') dev.add(norm);
        }
      }
      // Modern Poetry groups: [tool.poetry.group.<name>.dependencies]
      const groups = poetryObj.group;
      if (typeof groups === 'object' && groups !== null && !Array.isArray(groups)) {
        for (const grp of Object.values(groups as Record<string, unknown>)) {
          if (typeof grp !== 'object' || grp === null) continue;
          const grpObj = grp as Record<string, unknown>;
          const gdeps = grpObj.dependencies;
          if (typeof gdeps === 'object' && gdeps !== null && !Array.isArray(gdeps)) {
            for (const key of Object.keys(gdeps as Record<string, unknown>)) {
              if (key === 'python') continue;
              const norm = normalizePackageName(key);
              if (norm !== '') dev.add(norm);
            }
          }
        }
      }
    }

    // ── uv: [tool.uv] / [tool.uv.sources] ────────────────────────────────
    // uv supports PEP 621 natively; its own tables mostly add metadata to
    // already-declared deps. `[tool.uv.sources]` keys are package names that
    // override fetch sources for already-declared PEP 621 deps. We harvest
    // the keys defensively in case they appear without a matching PEP 621
    // entry (uncommon but legal).
    const uv = toolObj.uv;
    if (typeof uv === 'object' && uv !== null) {
      const uvObj = uv as Record<string, unknown>;
      const sources = uvObj.sources;
      if (typeof sources === 'object' && sources !== null && !Array.isArray(sources)) {
        for (const key of Object.keys(sources as Record<string, unknown>)) {
          const norm = normalizePackageName(key);
          if (norm !== '') runtime.add(norm);
        }
      }
      // uv also defines `dev-dependencies` (PEP-621-adjacent extension).
      const uvDev = uvObj['dev-dependencies'];
      if (Array.isArray(uvDev)) {
        for (const name of parsePep508List(uvDev)) dev.add(name);
      }
    }
  }

  if (runtime.size === 0 && dev.size === 0 && optional.size === 0) return null;
  return { runtime, dev, optional };
}

/**
 * Parse setup.cfg (INI) for `install_requires` and `extras_require`. Tiny
 * hand-rolled INI parser — we don't pull a dependency.
 */
function tryReadSetupCfg(
  path: string,
  fs: FsAdapter,
): {
  runtime: Set<string>;
  dev: Set<string>;
} | null {
  if (!fs.existsSync(path) || fs.isDirectorySync(path)) return null;
  let text: string;
  try {
    text = fs.readFileSync(path, 'utf8');
  } catch {
    return null;
  }

  const sections = new Map<string, string[]>();
  let currentSection: string | null = null;
  let currentKey: string | null = null;
  let currentLines: string[] = [];

  const flushKey = (): void => {
    if (currentSection === null || currentKey === null) return;
    const sectionKey = `${currentSection}.${currentKey}`;
    sections.set(sectionKey, currentLines);
    currentKey = null;
    currentLines = [];
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine;
    const stripped = line.trim();
    if (stripped === '' || stripped.startsWith('#') || stripped.startsWith(';')) continue;
    if (line.startsWith('[') && stripped.endsWith(']')) {
      flushKey();
      currentSection = stripped.slice(1, -1).trim();
      continue;
    }
    // Continuation line (indented + not a key=value).
    if (/^[\t ]/.test(line) && currentKey !== null) {
      currentLines.push(stripped);
      continue;
    }
    // New key=value or key: value.
    const eq = line.indexOf('=');
    const colon = line.indexOf(':');
    let sep = -1;
    if (eq !== -1 && (colon === -1 || eq < colon)) sep = eq;
    else if (colon !== -1) sep = colon;
    if (sep === -1) continue;
    flushKey();
    const key = line.slice(0, sep).trim();
    const valuePart = line.slice(sep + 1).trim();
    currentKey = key;
    currentLines = valuePart === '' ? [] : [valuePart];
  }
  flushKey();

  const runtime = new Set<string>();
  const dev = new Set<string>();

  const installReqLines = sections.get('options.install_requires');
  if (installReqLines !== undefined) {
    for (const name of parsePep508List(installReqLines)) runtime.add(name);
  }

  // Walk every options.extras_require.<group> key.
  for (const [sectionKey, lines] of sections) {
    if (!sectionKey.startsWith('options.extras_require.')) continue;
    for (const name of parsePep508List(lines)) dev.add(name);
  }

  if (runtime.size === 0 && dev.size === 0) return null;
  return { runtime, dev };
}

/**
 * Best-effort regex extraction of `install_requires=[...]` from setup.py.
 * Handles literal lists of strings only. Non-literal forms (variable refs,
 * function calls, list comprehensions) are silently skipped.
 */
function tryReadSetupPy(path: string, fs: FsAdapter): { runtime: Set<string> } | null {
  if (!fs.existsSync(path) || fs.isDirectorySync(path)) return null;
  let text: string;
  try {
    text = fs.readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const runtime = new Set<string>();
  // Match `install_requires` then `=` then `[...]`. The list body is captured.
  // We use a non-greedy match for the list to stop at the FIRST closing `]`.
  const listMatch = /install_requires\s*=\s*\[([\s\S]*?)\]/.exec(text);
  if (listMatch === null) return null;
  const body = listMatch[1] ?? '';
  // Pull every quoted string out — single, double, or triple quoted single-line forms.
  const stringRe = /(?:'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|"([^"\\\n]*(?:\\.[^"\\\n]*)*)")/g;
  for (const m of body.matchAll(stringRe)) {
    const literal = m[1] ?? m[2] ?? '';
    const name = extractRequirementName(literal);
    if (name !== '') runtime.add(name);
  }
  if (runtime.size === 0) return null;
  return { runtime };
}

/**
 * Parse a single requirements*.txt file. Strips comments, URL-form refs, env
 * markers. Returns the set of normalized package names found.
 */
function parseRequirementsTxt(text: string): Set<string> {
  const out = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine;
    // Strip inline comments. URLs use `#egg=` as a fragment, not a comment —
    // pip's rule is "a `#` preceded by a space is a comment, otherwise it's
    // part of the URL". Mirror that.
    const commentMatch = / #/.exec(line);
    if (commentMatch !== null) {
      line = line.slice(0, commentMatch.index);
    } else if (line.startsWith('#')) {
      line = '';
    }
    line = line.trim();
    if (line === '') continue;
    // Skip pip directives that don't introduce a package name.
    if (line.startsWith('-r ') || line === '-r' || line.startsWith('--requirement')) continue;
    if (line.startsWith('-c ') || line === '-c' || line.startsWith('--constraint')) continue;
    if (line.startsWith('-i ') || line.startsWith('--index-url')) continue;
    if (line.startsWith('--extra-index-url')) continue;
    if (line.startsWith('--find-links')) continue;
    if (line.startsWith('--no-index')) continue;
    if (line.startsWith('--pre')) continue;
    if (line.startsWith('--')) continue;
    // `-e <url-or-path>` editable installs — skip URLs/paths.
    if (line.startsWith('-e ')) {
      const rest = line.slice(3).trim();
      // Try `egg=<name>` form.
      const eggMatch = /egg=([A-Za-z0-9._-]+)/.exec(rest);
      if (eggMatch !== null) {
        const name = normalizePackageName(eggMatch[1] ?? '');
        if (name !== '') out.add(name);
      }
      continue;
    }
    // VCS / URL forms.
    if (line.startsWith('git+') || line.startsWith('hg+') || line.startsWith('svn+')) {
      const eggMatch = /egg=([A-Za-z0-9._-]+)/.exec(line);
      if (eggMatch !== null) {
        const name = normalizePackageName(eggMatch[1] ?? '');
        if (name !== '') out.add(name);
      }
      continue;
    }
    if (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('file:')) {
      const eggMatch = /egg=([A-Za-z0-9._-]+)/.exec(line);
      if (eggMatch !== null) {
        const name = normalizePackageName(eggMatch[1] ?? '');
        if (name !== '') out.add(name);
      }
      continue;
    }
    const name = extractRequirementName(line);
    if (name !== '') out.add(name);
  }
  return out;
}

/**
 * Read manifest at `projectRoot`. Walk files in the documented precedence
 * order; first file that yields any names wins.
 *
 * @param projectRoot Absolute POSIX path to the project root.
 * @param fs          Filesystem adapter.
 */
export function loadPythonManifest(projectRoot: string, fs: FsAdapter): PythonManifest {
  // 1. pyproject.toml
  const pyproject = tryReadPyproject(joinPosix(projectRoot, 'pyproject.toml'), fs);
  if (pyproject !== null) {
    return finalize(pyproject.runtime, pyproject.dev, pyproject.optional, 'pyproject');
  }

  // 2. setup.cfg
  const setupCfg = tryReadSetupCfg(joinPosix(projectRoot, 'setup.cfg'), fs);
  if (setupCfg !== null) {
    return finalize(setupCfg.runtime, setupCfg.dev, new Set<string>(), 'setup-cfg');
  }

  // 3. setup.py
  const setupPy = tryReadSetupPy(joinPosix(projectRoot, 'setup.py'), fs);
  if (setupPy !== null) {
    return finalize(setupPy.runtime, new Set<string>(), new Set<string>(), 'setup-py');
  }

  // 4. requirements*.txt — read both `requirements.txt` (runtime) and a small
  //    fixed list of dev-flavored variants. We do NOT enumerate the directory
  //    (no determinism risk) — just probe the canonical filenames.
  const runtimeSet = new Set<string>();
  const devSet = new Set<string>();

  const runtimeFile = joinPosix(projectRoot, 'requirements.txt');
  if (fs.existsSync(runtimeFile) && !fs.isDirectorySync(runtimeFile)) {
    try {
      for (const name of parseRequirementsTxt(fs.readFileSync(runtimeFile, 'utf8'))) {
        runtimeSet.add(name);
      }
    } catch {
      // best-effort
    }
  }

  for (const name of [
    'requirements-dev.txt',
    'requirements_dev.txt',
    'dev-requirements.txt',
    'requirements-test.txt',
    'requirements_test.txt',
  ]) {
    const path = joinPosix(projectRoot, name);
    if (fs.existsSync(path) && !fs.isDirectorySync(path)) {
      try {
        for (const pkg of parseRequirementsTxt(fs.readFileSync(path, 'utf8'))) {
          devSet.add(pkg);
        }
      } catch {
        // best-effort
      }
    }
  }

  if (runtimeSet.size > 0 || devSet.size > 0) {
    return finalize(runtimeSet, devSet, new Set<string>(), 'requirements');
  }

  return EMPTY_PYTHON_MANIFEST;
}

function finalize(
  runtime: Set<string>,
  dev: Set<string>,
  optional: Set<string>,
  source: PythonManifest['source'],
): PythonManifest {
  const all = new Set<string>();
  for (const n of runtime) all.add(n);
  for (const n of dev) all.add(n);
  return Object.freeze({
    runtime: Object.freeze(runtime) as ReadonlySet<string>,
    dev: Object.freeze(dev) as ReadonlySet<string>,
    optional: Object.freeze(optional) as ReadonlySet<string>,
    all: Object.freeze(all) as ReadonlySet<string>,
    source,
  });
}
