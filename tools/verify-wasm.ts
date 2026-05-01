#!/usr/bin/env bun
/**
 * verify-wasm.ts — verify pinned WASM blob hashes match on-disk content.
 *
 * Reads tools/wasm-pins.json (a flat object mapping relative path -> sha256 hex),
 * streams each file through createHash('sha256'), and exits 1 with a verbatim
 * error message on first mismatch. Empty pins -> exit 0 silently.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const PINS_PATH = resolve(REPO_ROOT, 'tools', 'wasm-pins.json');

type PinMap = Record<string, string>;

async function loadPins(path: string): Promise<PinMap> {
  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`tools/wasm-pins.json must be a JSON object, got ${typeof parsed}`);
  }
  const out: PinMap = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      throw new Error(`tools/wasm-pins.json: pin for '${k}' must be a hex string`);
    }
    out[k] = v;
  }
  return out;
}

async function hashFile(absolutePath: string): Promise<string> {
  const hasher = createHash('sha256');
  await pipeline(createReadStream(absolutePath), hasher);
  return hasher.digest('hex');
}

async function main(): Promise<number> {
  const pins = await loadPins(PINS_PATH);
  const entries = Object.entries(pins);
  if (entries.length === 0) {
    return 0;
  }

  for (const [relPath, expected] of entries) {
    const absPath = resolve(REPO_ROOT, relPath);
    const actual = await hashFile(absPath);
    if (actual !== expected) {
      console.error(
        `WASM integrity check failed for ${relPath}: expected ${expected}, got ${actual}`,
      );
      return 1;
    }
  }
  return 0;
}

const exitCode = await main();
process.exit(exitCode);
