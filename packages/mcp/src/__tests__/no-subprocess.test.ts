/**
 * no-subprocess.test.ts — Phase 3h.4 — D1 / FR-K6 enforcement.
 *
 * The MCP server must NOT spawn `fugazi` as a subprocess; it links
 * `@fugazi/core` directly. This source-grep gate scans every TS file under
 * `packages/mcp/src/` (excluding tests) and asserts that none import or use
 * `child_process`, `node:child_process`, or `bun:spawn` /
 * `Bun.spawn` patterns.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const FORBIDDEN_PATTERNS: readonly string[] = Object.freeze([
  'child_process',
  'node:child_process',
  'Bun.spawn',
  'bun:spawn',
]);

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..');

async function listTsFiles(dir: string): Promise<readonly string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip the test directory: tests legitimately reference grep targets.
      if (entry.name === '__tests__') continue;
      const nested = await listTsFiles(full);
      out.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

describe('MCP source has no subprocess hooks (D1)', () => {
  it('every src/*.ts file is free of child_process / Bun.spawn references', async () => {
    const files = await listTsFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = await readFile(file, 'utf8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(
          src.includes(pattern),
          `${file} unexpectedly contains forbidden pattern: ${pattern}`,
        ).toBe(false);
      }
    }
  });
});
