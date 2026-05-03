#!/usr/bin/env bun
/**
 * copy-data.ts — copy `src/data/*.json` to `dist/data/*.json` after `tsc -b`.
 *
 * The loader supports both layouts (post-build vs in-tree). This script makes
 * the post-build layout primary so a published or built copy of the package
 * does not need to walk back to `src/`.
 */

import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const SRC_DATA = join(PKG_ROOT, 'src', 'data');
const DIST_DATA = join(PKG_ROOT, 'dist', 'data');

function main(): void {
  let entries: string[];
  try {
    entries = readdirSync(SRC_DATA);
  } catch {
    return;
  }
  mkdirSync(DIST_DATA, { recursive: true });
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const src = join(SRC_DATA, name);
    const dest = join(DIST_DATA, name);
    try {
      const stat = statSync(src);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    copyFileSync(src, dest);
  }
}

main();
