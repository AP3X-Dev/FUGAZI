/**
 * tools/_shared.ts — Phase 3h.6 — internal helpers shared across tools that
 * need a `FugaziConfig` (fix_apply, fix_dry_run).
 *
 * Mirrors the loader the CLI and Node-API use so all four consumers see the
 * same fall-back: `.fugazirc.json` if present, permissive parse over `{}`
 * otherwise.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type FugaziConfig, FugaziConfigSchemaPermissive, loadJsonConfig } from '@fugazi/config';

export async function loadConfigForRoot(projectRoot: string): Promise<FugaziConfig> {
  const candidate = join(projectRoot, '.fugazirc.json');
  let raw: unknown = {};
  if (existsSync(candidate)) {
    try {
      raw = await loadJsonConfig(candidate);
    } catch {
      raw = {};
    }
  }
  return FugaziConfigSchemaPermissive.parse(raw) as FugaziConfig;
}
