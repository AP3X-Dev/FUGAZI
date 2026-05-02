/**
 * __type-checks__.ts — Phase 3h.4 — compile-time invariant checks.
 *
 * This file is included by `tsc --noEmit` (the test-globs exclusion does NOT
 * cover it). The `@ts-expect-error` lines below FAIL TO COMPILE if the
 * brand-based read-only invariant is ever weakened — making this a
 * compile-time canary for FR-K5 / IMP-SEC-07.
 *
 * No runtime side-effects. The exports are typed-only assertions.
 */

import { z } from 'zod';
import {
  type AnyMutatingTool,
  type AnyReadOnlyTool,
  defineMutatingTool,
  defineReadOnlyTool,
} from './types.js';

const SAMPLE_SCHEMA = z.object({});

const sampleRO = defineReadOnlyTool({
  name: '__sample_ro',
  description: 'sample',
  schema: SAMPLE_SCHEMA,
  handler: async () => ({
    data: 1,
    _meta: { schemaVersion: 1 as const, correlationId: 'x', progress: [], tookMs: 0 },
  }),
});

const sampleMut = defineMutatingTool({
  name: '__sample_mut',
  description: 'sample',
  schema: SAMPLE_SCHEMA,
  handler: async () => ({
    data: 1,
    _meta: { schemaVersion: 1 as const, correlationId: 'x', progress: [], tookMs: 0 },
  }),
});

// Same kind on both sides — must compile.
export const _ok1: AnyReadOnlyTool = sampleRO;
export const _ok2: AnyMutatingTool = sampleMut;

// Cross-kind — must FAIL. The `@ts-expect-error` directive itself errors
// if the underlying assignment compiles without diagnostic.
// @ts-expect-error - MutatingTool is not assignable to ReadOnlyTool (brand mismatch).
export const _bad1: AnyReadOnlyTool = sampleMut;
// @ts-expect-error - ReadOnlyTool is not assignable to MutatingTool (brand mismatch).
export const _bad2: AnyMutatingTool = sampleRO;
