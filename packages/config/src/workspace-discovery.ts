/**
 * workspace-discovery.ts — T043 implementation.
 *
 * Detects whether `<projectRoot>` is a single-package repo or a workspace
 * monorepo (npm / pnpm / yarn / bun) and enumerates the absolute paths to
 * each member package.
 *
 * Detection priority for the `kind`:
 *   1. `bun.lock`            → bun
 *   2. `pnpm-lock.yaml`      → pnpm
 *   3. `yarn.lock`           → yarn
 *   4. `package-lock.json`   → npm
 *   5. (none)                → single
 *
 * Workspace declarations:
 *   - npm / yarn / bun read `package.json` `workspaces` (array OR `{ packages: [...] }`).
 *   - pnpm reads `pnpm-workspace.yaml` (`packages: [...]`).
 *
 * Output is deterministic: deduped, sorted absolute paths. Glob expansion is
 * a single walk via `tinyglobby`.
 */
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { glob } from 'tinyglobby';

export type WorkspaceKind = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'single';

export interface WorkspaceInfo {
  readonly kind: WorkspaceKind;
  readonly root: string;
  readonly packages: readonly string[];
}

/**
 * Inspect `<projectRoot>` and return its workspace shape. Pure function modulo
 * filesystem reads — no caching, no globals, no subprocess calls.
 */
export async function discoverWorkspaces(projectRoot: string): Promise<WorkspaceInfo> {
  const root = resolve(projectRoot);

  const pkgJson = await readPackageJson(join(root, 'package.json'));
  if (pkgJson === undefined) {
    return { kind: 'single', root, packages: [] };
  }

  const kind = await detectKind(root);
  if (kind === 'single') {
    return { kind, root, packages: [] };
  }

  const patterns = await readWorkspacePatterns(root, kind, pkgJson);
  if (patterns.length === 0) {
    return { kind, root, packages: [] };
  }

  const packages = await expandWorkspacePatterns(root, patterns);
  return { kind, root, packages };
}

/* ------------------------------------------------------------------------ */
/* Internal helpers                                                          */
/* ------------------------------------------------------------------------ */

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(path: string): Promise<Record<string, unknown> | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
  // Strip a UTF-8 BOM if present so JSON.parse doesn't choke on it (E3).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

async function detectKind(root: string): Promise<WorkspaceKind> {
  // Priority order: bun > pnpm > yarn > npm.
  if (await pathExists(join(root, 'bun.lock'))) return 'bun';
  if (await pathExists(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await pathExists(join(root, 'yarn.lock'))) return 'yarn';
  if (await pathExists(join(root, 'package-lock.json'))) return 'npm';
  return 'single';
}

async function readWorkspacePatterns(
  root: string,
  kind: WorkspaceKind,
  pkgJson: Record<string, unknown>,
): Promise<readonly string[]> {
  if (kind === 'pnpm') {
    return await readPnpmWorkspacePatterns(root);
  }
  return readPackageJsonWorkspaces(pkgJson);
}

function readPackageJsonWorkspaces(pkgJson: Record<string, unknown>): readonly string[] {
  const ws = pkgJson.workspaces;
  if (Array.isArray(ws)) {
    return ws.filter((entry): entry is string => typeof entry === 'string');
  }
  if (ws !== null && typeof ws === 'object') {
    const inner = (ws as Record<string, unknown>).packages;
    if (Array.isArray(inner)) {
      return inner.filter((entry): entry is string => typeof entry === 'string');
    }
  }
  return [];
}

async function readPnpmWorkspacePatterns(root: string): Promise<readonly string[]> {
  const path = join(root, 'pnpm-workspace.yaml');
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(text);
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== 'object') return [];
  const inner = (parsed as Record<string, unknown>).packages;
  if (!Array.isArray(inner)) return [];
  return inner.filter((entry): entry is string => typeof entry === 'string');
}

async function expandWorkspacePatterns(
  root: string,
  patterns: readonly string[],
): Promise<readonly string[]> {
  // tinyglobby: ask only for directories so we can then verify each holds a
  // package.json. A single walk handles all patterns.
  const matches = await glob(patterns as string[], {
    cwd: root,
    onlyDirectories: true,
    absolute: true,
    dot: false,
    expandDirectories: false,
  });

  // Filter to directories that contain a package.json, dedupe, and sort.
  // tinyglobby emits POSIX-style paths with trailing separators; resolve()
  // re-canonicalises to the platform-native shape.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of matches) {
    const normalized = resolve(match);
    if (seen.has(normalized)) continue;
    if (await pathExists(join(normalized, 'package.json'))) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out.sort();
}
