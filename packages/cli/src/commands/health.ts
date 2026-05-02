/**
 * commands/health.ts — Phase 3h.2 (T184) — `fugazi health`.
 *
 * Default path runs `runAnalysis({ kind: 'health-only' })` (the registered
 * health-family rules: complexity-hotspot, cognitive-complexity).
 *
 * The optional `--score` flag short-circuits the rule path: it walks the
 * project directly via `parse + computeComplexity`, computes per-file scores
 * via `computeFileScore`, then collapses to the project mean via
 * `computeProjectScore`. Single-line stdout output (`formatScoreLine`); always
 * exits 0.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import {
  type HealthScore,
  computeFileScore,
  computeProjectScore,
  formatScoreLine,
} from '@fugazi/core';
import { computeComplexity, parse } from '@fugazi/extract';
import { Option } from 'clipanion';
import { FugaziCommand } from './base.js';
import { runAndReport } from './run-helpers.js';

const RECOGNIZED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.turbo']);

export class HealthCommand extends FugaziCommand {
  static override paths = [['health']];
  static override usage = {
    description: 'Run health-family rules; --score prints integer score',
  };

  score = Option.Boolean('--score', false, {
    description: 'Print a single integer health score and exit 0',
  });

  override async execute(): Promise<number> {
    if (!this.score) {
      return await runAndReport({
        mode: 'health-only',
        format: this.pickFormat(),
        quiet: this.quiet,
        projectRoot: process.cwd(),
        stdout: this.context.stdout,
        stderr: this.context.stderr,
        ciPreset: this.isCiPreset(),
      });
    }

    const projectRoot = process.cwd();
    const files = await discoverFiles(projectRoot);
    const perFile = new Map<string, HealthScore>();
    for (const path of files) {
      let source: string;
      try {
        source = await readFile(path, 'utf8');
      } catch {
        continue;
      }
      let parseResult: Awaited<ReturnType<typeof parse>>;
      try {
        parseResult = await parse(source, { filename: path, lang: langForExtension(path) });
      } catch {
        continue;
      }
      if (parseResult.program === null) continue;
      const complexity = computeComplexity(parseResult.program, source);
      const score = computeFileScore(complexity);
      perFile.set(
        path,
        Object.freeze({
          file: path,
          score,
          cyclomatic: complexity.aggregate.cyclomatic,
          cognitive: complexity.aggregate.cognitive,
          maintainabilityIndex: complexity.aggregate.maintainabilityIndex,
        }),
      );
    }
    const project = computeProjectScore(perFile);
    this.context.stdout.write(formatScoreLine(project));
    return 0;
  }
}

async function discoverFiles(projectRoot: string): Promise<readonly string[]> {
  const out: string[] = [];
  await walkDir(projectRoot, out);
  return out
    .map((p) => (sep === '\\' ? p.replaceAll('\\', '/') : p))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function walkDir(dir: string, out: string[]): Promise<void> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full, out);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      if (dot === -1) continue;
      const ext = entry.name.slice(dot);
      if (RECOGNIZED_EXTENSIONS.includes(ext)) {
        out.push(full);
      }
    }
  }
}

function langForExtension(path: string): 'ts' | 'tsx' | 'js' | 'jsx' {
  if (path.endsWith('.tsx')) return 'tsx';
  if (path.endsWith('.jsx')) return 'jsx';
  if (path.endsWith('.ts') || path.endsWith('.mts') || path.endsWith('.cts')) return 'ts';
  return 'js';
}
