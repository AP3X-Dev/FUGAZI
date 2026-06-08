#!/usr/bin/env bun
/**
 * forbidden-env.ts — SC-18 enforcement.
 *
 * Scans packages/<*>/src/<**>/<*>.{ts,js} for FALLOW_ env var reads via either
 * process.env or import.meta.env. Lists every violation, then exits 1 if any
 * were found, else 0.
 *
 * Allowlisted paths (skipped):
 *   - tools/forbidden-env.ts            (this scanner; the patterns are match data)
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// Phase 4e (T362): mirror the TS/JS env-read patterns onto the Python
// equivalents so a Python fixture or test plugin can't smuggle a FALLOW_*
// env read past the SC-18 gate. `os.environ['FALLOW_…']` and
// `os.getenv('FALLOW_…')` cover the two idiomatic forms.
const PATTERNS: ReadonlyArray<RegExp> = [
  /\bprocess\.env\.FALLOW_/,
  /\bimport\.meta\.env\.FALLOW_/,
  /\bos\.environ\[\s*['"]FALLOW_/,
  /\bos\.getenv\(\s*['"]FALLOW_/,
];

const ALLOWLISTED_PATHS = new Set([
  'tools/forbidden-env.ts',
]);

// Phase 4e (T362): scan Python source + stub files alongside TS/JS so the
// scanner catches a stray `os.environ['FALLOW_…']` in a fixture.
const EXTENSIONS = new Set(['.ts', '.js', '.py', '.pyi']);

function toRepoRel(absolute: string): string {
  return relative(REPO_ROOT, absolute).split(sep).join('/');
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      if (dot === -1) continue;
      const ext = entry.name.slice(dot);
      if (EXTENSIONS.has(ext)) yield full;
    }
  }
}

async function listSourceFiles(): Promise<string[]> {
  const packagesDir = resolve(REPO_ROOT, 'packages');
  let pkgEntries: Awaited<ReturnType<typeof readdir>>;
  try {
    pkgEntries = await readdir(packagesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const pkg of pkgEntries) {
    if (!pkg.isDirectory()) continue;
    const srcDir = join(packagesDir, pkg.name, 'src');
    try {
      const st = await stat(srcDir);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    for await (const f of walk(srcDir)) files.push(f);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

interface Violation {
  path: string;
  line: number;
  content: string;
}

function scanContent(repoRelPath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineContent = lines[i] ?? '';
    for (const re of PATTERNS) {
      if (re.test(lineContent)) {
        violations.push({ path: repoRelPath, line: i + 1, content: lineContent });
        break;
      }
    }
  }
  return violations;
}

async function main(): Promise<number> {
  const files = await listSourceFiles();
  const allViolations: Violation[] = [];

  for (const abs of files) {
    const rel = toRepoRel(abs);
    if (ALLOWLISTED_PATHS.has(rel)) continue;
    const content = await readFile(abs, 'utf8');
    allViolations.push(...scanContent(rel, content));
  }

  for (const v of allViolations) {
    console.error(`forbidden FALLOW_ env var read in ${v.path}:${v.line}: ${v.content}`);
  }

  return allViolations.length > 0 ? 1 : 0;
}

const exitCode = await main();
process.exit(exitCode);
