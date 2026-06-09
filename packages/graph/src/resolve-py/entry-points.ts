/**
 * resolve-py/entry-points.ts — declared Python entry-point discovery.
 *
 * Reads `<projectRoot>/pyproject.toml` and extracts the console / GUI / plugin
 * entry-point specifications, then resolves each one's module to a concrete
 * source file via the sys.path resolver. These are genuine reachability roots:
 * a `[project.scripts]` console script is invoked by the installed entry-point
 * wrapper, so its target module (and everything it imports) is live.
 *
 * Sources parsed (all optional; a missing/unparseable file yields `[]`):
 *   - PEP 621 `[project.scripts]` and `[project.gui-scripts]`
 *   - PEP 621 `[project.entry-points."<group>"]`
 *   - Poetry `[tool.poetry.scripts]` (string form and `{ callable = "…" }` form)
 *
 * Each spec is a reference of the form `module.path:callable` (or just
 * `module.path`); only the module part matters for file resolution. Modules
 * that do not resolve to a discovered file are dropped. The result is a
 * deterministically sorted, de-duplicated list of absolute POSIX file paths.
 */

import { parse as parseToml } from 'smol-toml';
import type { FsAdapter } from '../resolve/fs-adapter.js';
import { joinPosix } from '../resolve/path-utils.js';
import { resolveSysPath } from './sys-path.js';

/**
 * Resolve the declared Python entry-point modules of `projectRoot` to source
 * files. Returns absolute POSIX paths, sorted and de-duplicated. Never throws.
 */
export function loadPythonEntryPoints(projectRoot: string, fs: FsAdapter): readonly string[] {
  const specs = readEntryPointSpecs(projectRoot, fs);
  const resolved = new Set<string>();
  for (const spec of specs) {
    const moduleName = moduleOf(spec);
    if (moduleName === '') continue;
    const file = resolveSysPath(moduleName, projectRoot, fs);
    if (file !== null) resolved.add(file);
  }
  return [...resolved].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Extract the module portion of a `module.path:callable` reference. */
function moduleOf(spec: string): string {
  const colon = spec.indexOf(':');
  const head = colon === -1 ? spec : spec.slice(0, colon);
  return head.trim();
}

/** Read every entry-point reference string declared in pyproject.toml. */
function readEntryPointSpecs(projectRoot: string, fs: FsAdapter): readonly string[] {
  const path = joinPosix(projectRoot, 'pyproject.toml');
  if (!fs.existsSync(path) || fs.isDirectorySync(path)) return [];
  let text: string;
  try {
    text = fs.readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = parseToml(text);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const obj = parsed as Record<string, unknown>;

  const out: string[] = [];

  // ── PEP 621: [project.scripts] / [project.gui-scripts] / [project.entry-points] ──
  const project = asRecord(obj.project);
  if (project !== null) {
    collectStringValues(project.scripts, out);
    collectStringValues(project['gui-scripts'], out);
    // [project.entry-points."group"] → { name = "module:attr" } per group.
    const entryPoints = asRecord(project['entry-points']);
    if (entryPoints !== null) {
      for (const group of Object.values(entryPoints)) collectStringValues(group, out);
    }
  }

  // ── Poetry: [tool.poetry.scripts] ──────────────────────────────────────
  const tool = asRecord(obj.tool);
  const poetry = tool !== null ? asRecord(tool.poetry) : null;
  if (poetry !== null) {
    const scripts = asRecord(poetry.scripts);
    if (scripts !== null) {
      for (const value of Object.values(scripts)) {
        if (typeof value === 'string') {
          out.push(value);
        } else {
          // Poetry rich form: { callable = "pkg.module:main", extras = [...] }.
          const rec = asRecord(value);
          if (rec !== null && typeof rec.callable === 'string') out.push(rec.callable);
        }
      }
    }
  }

  return out;
}

/** Push every string value of a `{ name = "module:attr" }` table into `out`. */
function collectStringValues(value: unknown, out: string[]): void {
  const rec = asRecord(value);
  if (rec === null) return;
  for (const v of Object.values(rec)) {
    if (typeof v === 'string') out.push(v);
  }
}

/** Narrow to a plain object (not null, not array). */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
