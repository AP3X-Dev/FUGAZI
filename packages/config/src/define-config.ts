/**
 * define-config.ts — IDE-inference identity helper for `fugazi.config.ts`.
 *
 * Users write:
 *
 *     import { defineConfig } from 'fugazi';
 *     export default defineConfig({ ... });
 *
 * The helper exists purely so editor tooling infers the FugaziConfig type at
 * the call site. At runtime it is a pass-through.
 */
import type { FugaziConfig } from './schema.js';

export function defineConfig(config: FugaziConfig): FugaziConfig {
  return config;
}
