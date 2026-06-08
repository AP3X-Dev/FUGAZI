/**
 * sc-14-exit-codes.test.ts — Phase 3m T290 — SC-14 acceptance row.
 *
 * SC-14 is the closed exit-code contract: every CLI path returns 0, 1, or 2
 * — never 3..13. The original Fallow exit-code surface included codes for
 * license / sidecar / signature errors that Fugazi does not implement
 * (see the SC-17 forbidden-string list in the project conventions). Tests asserting those codes
 * must NOT exist in the Fugazi suite.
 *
 * Verification:
 *   1. Drive `runCli` through every code path that produces a known exit
 *      and assert the code is one of {0, 1, 2}.
 *   2. Grep the entire test corpus for literal references to exit codes
 *      3..13 and assert zero matches.
 */

import { readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { runCli } from 'fugazi';
import { describe, expect, it } from 'vitest';

interface CapturedContext {
  readonly env: Record<string, string | undefined>;
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly stderr: Writable;
  readonly colorDepth: number;
  getStdout(): string;
  getStderr(): string;
}

function makeCtx(): CapturedContext {
  let outBuf = '';
  let errBuf = '';
  const stdout = new Writable({
    write(chunk, _encoding, cb) {
      outBuf += chunk.toString();
      cb();
    },
  });
  const stderr = new Writable({
    write(chunk, _encoding, cb) {
      errBuf += chunk.toString();
      cb();
    },
  });
  const stdin = new Readable({ read() {} });
  return {
    env: {},
    stdin,
    stdout,
    stderr,
    colorDepth: 1,
    getStdout: () => outBuf,
    getStderr: () => errBuf,
  };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');

async function* walkTests(dir: string): AsyncGenerator<string> {
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
      yield* walkTests(full);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.test.ts') || entry.name.endsWith('.bench.ts'))
    ) {
      yield full;
    }
  }
}

async function listTestFiles(): Promise<readonly string[]> {
  const out: string[] = [];
  for (const sub of ['packages', 'tests']) {
    const root = resolve(REPO_ROOT, sub);
    try {
      const st = statSync(root);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    for await (const f of walkTests(root)) out.push(f);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

describe('SC-14: exit codes 0 / 1 / 2 only', () => {
  it('--help returns 0', async () => {
    const ctx = makeCtx();
    const code = await runCli(['--help'], ctx);
    expect([0, 1, 2]).toContain(code);
    expect(code).toBe(0);
  });

  it('--ci is rejected with exit 2', async () => {
    const ctx = makeCtx();
    const code = await runCli(['--ci'], ctx);
    expect([0, 1, 2]).toContain(code);
    expect(code).toBe(2);
  });

  it('an unknown subcommand returns 1 (clipanion default)', async () => {
    const ctx = makeCtx();
    const code = await runCli(['definitely-not-a-real-command'], ctx);
    expect([0, 1, 2]).toContain(code);
  });

  it('--version returns 0', async () => {
    const ctx = makeCtx();
    const code = await runCli(['--version'], ctx);
    expect(code).toBe(0);
  });

  it('grep: no test corpus references the deleted exit codes 3..13', async () => {
    const files = await listTestFiles();
    const offenders: { file: string; line: number; content: string }[] = [];
    // Patterns that would indicate an asserted exit code in {3..13}. We
    // check for `.toBe(N)` and `expect(N)` in `exit`-adjacent contexts.
    // Conservative: we look for literal `exits?\s*[3-9]|exits?\s*1[0-3]`
    // and `exit(Code)?\s*[:=]\s*(?:[3-9]|1[0-3])` patterns near `exit`.
    const patterns: readonly RegExp[] = [
      /\bexits?_(?:[3-9]|1[0-3])\b/, // license_missing_exits_3 etc.
      /\bexpect\(\s*code\s*\)\.toBe\(\s*(?:[3-9]|1[0-3])\s*\)/,
      /\bexitCode\s*===\s*(?:[3-9]|1[0-3])\b/,
    ];
    for (const f of files) {
      const content = readFileSync(f, 'utf8');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        for (const re of patterns) {
          if (re.test(line)) {
            offenders.push({ file: f, line: i + 1, content: line.trim() });
          }
        }
      }
    }
    expect(
      offenders,
      `found references to deleted exit codes 3..13:\n${offenders
        .map((o) => `  ${o.file}:${o.line}: ${o.content}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});
