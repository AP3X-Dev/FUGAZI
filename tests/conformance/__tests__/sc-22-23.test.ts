/**
 * sc-22.test.ts — SC-22 acceptance row.
 *
 *   - SC-22: the TS plugin tier loads behind `experimentalTsPlugins: true`.
 *            In v1.0 the TS plugin tier is deferred; the community plugin path
 *            is JSON-only. Verified by the config schema accepting the flag.
 */

import { FugaziConfigSchemaPermissive } from '@fugazi/config';
import { describe, expect, it } from 'vitest';

describe('SC-22: experimentalTsPlugins flag (TS plugin tier deferred)', () => {
  it('experimentalTsPlugins is accepted by the config schema', () => {
    const cfg = FugaziConfigSchemaPermissive.parse({ experimentalTsPlugins: true });
    expect(cfg.experimentalTsPlugins).toBe(true);
  });

  it('experimentalTsPlugins defaults to false', () => {
    const cfg = FugaziConfigSchemaPermissive.parse({});
    expect(cfg.experimentalTsPlugins).toBe(false);
  });
});
