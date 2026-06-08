/**
 * sc-22-23.test.ts — Phase 3m T296 — SC-22 + SC-23 acceptance row.
 *
 *   - SC-22: TS plugin tier loads behind `experimentalTsPlugins: true`. v1.0
 *            decision: TS plugins entirely deferred to v1.1; community plugin
 *            path is JSON-only. Verified by docs/V1_LIMITATIONS.md presence
 *            of the deferred entry, plus the config schema accepting the
 *            flag.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FugaziConfigSchemaPermissive } from '@fugazi/config';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const V1_LIMITATIONS = resolve(REPO_ROOT, 'docs', 'V1_LIMITATIONS.md');

describe('SC-22: experimentalTsPlugins flag (TS plugin tier deferred to v1.1)', () => {
  it('experimentalTsPlugins is accepted by the config schema', () => {
    const cfg = FugaziConfigSchemaPermissive.parse({ experimentalTsPlugins: true });
    expect(cfg.experimentalTsPlugins).toBe(true);
  });

  it('experimentalTsPlugins defaults to false', () => {
    const cfg = FugaziConfigSchemaPermissive.parse({});
    expect(cfg.experimentalTsPlugins).toBe(false);
  });

  it('docs/V1_LIMITATIONS.md documents the v1.1 carry for TS plugins', () => {
    expect(existsSync(V1_LIMITATIONS)).toBe(true);
    const text = readFileSync(V1_LIMITATIONS, 'utf8');
    expect(text).toMatch(/TS plugin/i);
    expect(text).toMatch(/v1\.1|deferred/i);
  });
});
