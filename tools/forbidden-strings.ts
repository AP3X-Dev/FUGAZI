#!/usr/bin/env bun
/**
 * forbidden-strings.ts — SC-17 enforcement.
 *
 * Scans packages/<*>/src/<**>/<*>.{ts,js,json} for case-insensitive whole-word
 * matches against the SC-17 token list. Lists every violation, then exits 1 if
 * any were found, else 0.
 *
 * Allowlisted paths (skipped):
 *   - LICENSE                                 (the MIT text)
 *   - docs/decisions/QUESTIONNAIRE.md         (records the SC-17 list as out-of-scope)
 *   - tools/forbidden-strings.ts              (this scanner; tokens are match data)
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

const FORBIDDEN_TOKENS = [
  'license',
  'JWT',
  'Ed25519',
  'grace',
  'watermark',
  'sidecar',
  'paid',
  'enterprise',
];

const ALLOWLISTED_PATHS = new Set([
  'LICENSE',
  'docs/decisions/QUESTIONNAIRE.md',
  'tools/forbidden-strings.ts',
]);

const EXTENSIONS = new Set(['.ts', '.js', '.json']);

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
  token: string;
  path: string;
  line: number;
  content: string;
}

function scanContent(repoRelPath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split(/\r?\n/);
  for (const token of FORBIDDEN_TOKENS) {
    const re = new RegExp(`\\b${token}\\b`, 'i');
    for (let i = 0; i < lines.length; i++) {
      const lineContent = lines[i] ?? '';
      if (re.test(lineContent)) {
        violations.push({
          token,
          path: repoRelPath,
          line: i + 1,
          content: lineContent,
        });
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
    console.error(`forbidden string '${v.token}' found in ${v.path}:${v.line}: ${v.content}`);
  }

  return allViolations.length > 0 ? 1 : 0;
}

const exitCode = await main();
process.exit(exitCode);
