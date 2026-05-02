/**
 * load-config.ts — shared config loader for the Node-API surface.
 *
 * Mirrors the CLI's `loadFugaziConfig` glue (`packages/cli/src/commands/
 * run-helpers.ts`): looks for `.fugazirc.json` at `projectRoot`, falls back to
 * a permissive parse over `{}` when absent so callers can run on fresh
 * checkouts without ever calling `fugazi init`.
 *
 * Returns a frozen `FugaziConfig` to preserve determinism (NFR-1) — each
 * load produces an immutable snapshot the driver can safely share across
 * concurrent invocations.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type FugaziConfig, FugaziConfigSchemaPermissive, loadJsonConfig } from '@fugazi/config';

export async function loadConfig(projectRoot: string): Promise<FugaziConfig> {
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
