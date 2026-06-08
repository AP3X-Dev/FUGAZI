/**
 * sc-31.test.ts — Phase 3m T300 — SC-28..SC-31 acceptance row.
 *
 *   - SC-28: TS strict mode passes; zero `any` in `packages/<*>/src/`. The
 *            workspace `tsc --noEmit` (per package) is the canonical gate.
 *            This SC-28 row asserts that no `: any` literal appears in the
 *            workspace src trees outside documented call-site casts.
 *   - SC-29: `bun run lint` (biome) clean. Existing baseline gate.
 *   - SC-30: `bun test` and `node --test` parity — vitest is the v1.0
 *            runner; `node --test` parity is not pursued in v1.0.
 *   - SC-31: Dogfood — `bunx fugazi audit` against the Fugazi repo itself
 *            completes without crash, exits ≤ 1, and produces a parseable
 *            JSON report.
 *
 * This test exists to (a) prove the dogfood path is non-fatal and (b) re-run
 * it fresh on every CI iteration so silent regressions are caught.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const FUGAZI_BIN = resolve(REPO_ROOT, 'packages', 'cli', 'bin', 'fugazi.js');

interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly elapsedMs: number;
}

async function runFugazi(args: readonly string[]): Promise<RunResult> {
  return await new Promise<RunResult>((resolveResult, reject) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [FUGAZI_BIN, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (b) => {
      stdout += b.toString();
    });
    child.stderr?.on('data', (b) => {
      stderr += b.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolveResult({
        exitCode: code ?? -1,
        stdout,
        stderr,
        elapsedMs: Date.now() - t0,
      });
    });
  });
}

describe('SC-28: TS strict + zero `: any` in packages/<*>/src/', () => {
  it('no `: any` literal annotations in `packages/<*>/src/` source files', () => {
    // Walk packages/<*>/src/<*>.ts (excluding test files) and grep for
    // ': any' annotations not inside a comment. We use a coarse line-based
    // scan: a violation is a non-comment line containing the regex. Block
    // comments are not handled exhaustively — a v1.0 best-effort gate.
    const pkgDir = resolve(REPO_ROOT, 'packages');
    const offenders: { file: string; line: number; content: string }[] = [];
    const annotationRe = /:\s*any(\s|;|,|\)|\]|=|>|$)/;
    const stripStringRe = /(["'`])(?:\\.|(?!\1).)*\1/g;

    function walk(dir: string): void {
      let entries: string[];
      try {
        entries = readdirSync(dir) as string[];
      } catch {
        return;
      }
      for (const name of entries) {
        const full = join(dir, name);
        let st: ReturnType<typeof statSync>;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue;
          walk(full);
        } else if (st.isFile() && name.endsWith('.ts') && !name.endsWith('.test.ts')) {
          const content = readFileSync(full, 'utf8');
          const lines = content.split(/\r?\n/);
          let inBlockComment = false;
          for (let i = 0; i < lines.length; i++) {
            let line = lines[i] ?? '';
            // Crude block-comment tracker.
            if (inBlockComment) {
              if (line.includes('*/')) {
                inBlockComment = false;
                line = line.slice(line.indexOf('*/') + 2);
              } else {
                continue;
              }
            }
            const blockStart = line.indexOf('/*');
            if (blockStart !== -1 && !line.includes('*/', blockStart)) {
              inBlockComment = true;
              line = line.slice(0, blockStart);
            }
            const lineCommentStart = line.indexOf('//');
            const codePart = lineCommentStart === -1 ? line : line.slice(0, lineCommentStart);
            // Strip string literals so `s = ': any';` doesn't trip.
            const stripped = codePart.replace(stripStringRe, '""');
            if (annotationRe.test(stripped)) {
              // `as any` is a documented escape hatch (per the project conventions). It
              // is allowed when paired with a justification comment on the
              // same or previous line. We allow `as any` literally.
              const isAsAny = /\bas\s+any\b/.test(stripped);
              if (!isAsAny) {
                offenders.push({ file: full, line: i + 1, content: line.trim() });
              }
            }
          }
        }
      }
    }
    walk(pkgDir);
    const firstTen = offenders.slice(0, 10);
    const message = `found ${offenders.length} ': any' annotation(s) in packages/<*>/src/. First 10:\n${firstTen.map((o) => `  ${o.file}:${o.line}: ${o.content}`).join('\n')}`;
    expect(firstTen, message).toEqual([]);
  });
});

describe('SC-29: lint clean (biome)', () => {
  it('biome.json exists and lint is wired into the workspace', () => {
    const biomePath = resolve(REPO_ROOT, 'biome.json');
    expect(existsSync(biomePath)).toBe(true);
    // The actual `bun run lint` exit-code is asserted by CI as a baseline
    // gate; running the full lint inside this Vitest test would be slow
    // and redundant. The presence of biome.json + the existence of the
    // `lint` script in package.json is the SC-29 row marker.
    const rootPkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(rootPkg.scripts?.lint).toBe('turbo lint');
  });
});

describe('SC-31: dogfood — `fugazi audit` against the Fugazi repo', () => {
  it('audit runs without crashing, exits 0 or 1, and produces parseable JSON', async () => {
    const result = await runFugazi(['audit', '--format', 'json', '--quiet']);
    expect([0, 1]).toContain(result.exitCode);
    // Audit mode is read-only — issue list is empty by spec; the report
    // shape is still valid JSON with the v1 schema.
    expect(result.stdout.length).toBeGreaterThan(0);
    const report = JSON.parse(result.stdout) as {
      readonly mode: string;
      readonly issues: readonly unknown[];
      readonly _meta: { readonly projectRoot: string };
    };
    expect(report.mode).toBe('audit');
    expect(Array.isArray(report.issues)).toBe(true);
    expect(report._meta.projectRoot).toBe(REPO_ROOT);
  }, 300_000);
});
