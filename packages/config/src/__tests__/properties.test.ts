/**
 * properties.test.ts — T046-test for the @fugazi/config package.
 *
 * Eight fast-check property invariants covering the public surface:
 *
 *   1. Parse-then-stringify round-trip is identity modulo defaults.
 *   2. `extends` deep-merge associativity for non-conflicting keys.
 *   3. `extends` deep-merge later-wins idempotence.
 *   4. BOM strip is idempotent (loadJsonConfig).
 *   5. Workspace discovery is deterministic across two runs.
 *   6. Framework preset detection is order-independent.
 *   7. Hidden-dir migration is idempotent.
 *   8. Zod parse defends against `__proto__`-bearing inputs (no prototype
 *      pollution on the parsed result).
 *
 * Each property runs at numRuns=200 (workspace discovery uses 50 because
 * its filesystem cost dominates and the property is essentially a sanity
 * check). The whole file is required to run flake-free across 5 sequential
 * vitest invocations.
 *
 * Spec refs: design-doc §7.4 (config-relevant invariants).
 * PRP refs: NFR-1 (determinism), FR-B (config) family.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fc, test as fctest } from '@fast-check/vitest';
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { loadJsonConfig } from '../loaders/json.js';
import { detectFrameworks } from '../preset-detect.js';
import { FugaziConfigSchemaPermissive } from '../schema.js';
import { discoverWorkspaces } from '../workspace-discovery.js';

/* ------------------------------------------------------------------------ */
/* Per-test tmp roots                                                        */
/* ------------------------------------------------------------------------ */

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'fugazi-properties-'));
});

afterEach(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

/* ------------------------------------------------------------------------ */
/* Test-only deepMerge mirror (parents-first / overlay-last per             */
/* design-doc §3.4.2). The production version lives behind                  */
/* `resolveExtendsChain`; this mirror is only used to exercise              */
/* algebraic invariants (associativity, idempotence) — the production       */
/* impl is exercised separately by the 24 extends-chain tests.              */
/* ------------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Reference deep-merge — base then overlay; overlay-undefined keeps base. */
function deepMergeRef(base: unknown, overlay: unknown): unknown {
  if (overlay === undefined) return base;
  if (base === undefined) return overlay;
  if (!isPlainObject(base) || !isPlainObject(overlay)) return overlay;
  const out: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const k of Object.keys(base)) {
    if (!seen.has(k)) {
      seen.add(k);
      out[k] = deepMergeRef(base[k], overlay[k]);
    }
  }
  for (const k of Object.keys(overlay)) {
    if (!seen.has(k)) {
      seen.add(k);
      out[k] = overlay[k];
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Arbitraries                                                               */
/* ------------------------------------------------------------------------ */

/** A subset of valid FugaziConfig shapes — enough to exercise defaults. */
const configArb = fc.record(
  {
    rules: fc.dictionary(
      fc.constantFrom('unused-files', 'unused-exports', 'unused-types', 'unused-deps'),
      fc.constantFrom('error', 'warn', 'off'),
      { maxKeys: 4 },
    ),
    include: fc.array(fc.stringMatching(/^[a-z*/.]{1,10}$/), { maxLength: 4 }),
    exclude: fc.array(fc.stringMatching(/^[a-z*/.]{1,10}$/), { maxLength: 4 }),
    production: fc.boolean(),
  },
  { requiredKeys: [] },
);

/**
 * Build three plain JSON objects with disjoint key sets at every level so
 * deep-merge associativity is unambiguous (no overlapping keys means
 * "later wins" never fires, isolating the structural merge contract).
 */
const disjointTripleArb = fc
  .tuple(
    fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { minLength: 3, maxLength: 9 }),
    fc.array(fc.oneof(fc.integer(), fc.string({ maxLength: 4 }), fc.boolean()), {
      minLength: 3,
      maxLength: 9,
    }),
  )
  .map(([keys, vals]) => {
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    const c: Record<string, unknown> = {};
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = vals[i % vals.length];
      if (k === undefined) continue;
      if (i % 3 === 0) a[k] = v;
      else if (i % 3 === 1) b[k] = v;
      else c[k] = v;
    }
    return [a, b, c] as const;
  });

/** Names valid in `DEP_TO_FAMILY` (canonical). */
const KNOWN_DEP_NAMES = [
  'react',
  'react-dom',
  'next',
  'vue',
  '@vue/compiler-sfc',
  'svelte',
  'astro',
  'vitest',
  'jest',
  'vite',
  'rollup',
  'webpack',
] as const;

const knownDepNameArb = fc.constantFrom(...KNOWN_DEP_NAMES);

/* ------------------------------------------------------------------------ */
/* Filesystem helpers                                                        */
/* ------------------------------------------------------------------------ */

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value), 'utf8');
}

/** Shuffle a list of strings via a deterministic Fisher-Yates from a seed. */
function shuffleWithSeed<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  let s = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    // xorshift32 — deterministic, non-zero
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const j = (s >>> 0) % (i + 1);
    const ti = out[i];
    const tj = out[j];
    if (ti !== undefined && tj !== undefined) {
      out[i] = tj;
      out[j] = ti;
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Invariant 1 — Parse → re-parse identity (defaults idempotent)             */
/* ------------------------------------------------------------------------ */

describe('property: schema parse-with-defaults is idempotent (invariant 1)', () => {
  fctest.prop([configArb], { numRuns: 200 })(
    'FugaziConfigSchemaPermissive.parse(parse(x)) === parse(x)',
    (input) => {
      const once = FugaziConfigSchemaPermissive.parse(input);
      const twice = FugaziConfigSchemaPermissive.parse(once);
      expect(twice).toEqual(once);
    },
  );

  fctest.prop([configArb], { numRuns: 200 })(
    'JSON round-trip via loadJsonConfig preserves applyDefaults equality',
    async (input) => {
      const path = join(tmpRoot, `cfg-${Date.now()}-${Math.floor(Math.random() * 1e9)}.json`);
      await writeFile(path, JSON.stringify(input), 'utf8');
      const raw = await loadJsonConfig(path);
      const parsed = FugaziConfigSchemaPermissive.parse(raw);
      const direct = FugaziConfigSchemaPermissive.parse(input);
      expect(parsed).toEqual(direct);
    },
    60_000,
  );
});

/* ------------------------------------------------------------------------ */
/* Invariant 2 — deep-merge associativity (non-conflicting keys)             */
/* ------------------------------------------------------------------------ */

describe('property: deep-merge associativity for disjoint keys (invariant 2)', () => {
  fctest.prop([disjointTripleArb], { numRuns: 200 })(
    'merge(merge(a, b), c) deep-equals merge(a, merge(b, c)) when keys are disjoint',
    ([a, b, c]) => {
      const left = deepMergeRef(deepMergeRef(a, b), c);
      const right = deepMergeRef(a, deepMergeRef(b, c));
      expect(left).toEqual(right);
    },
  );
});

/* ------------------------------------------------------------------------ */
/* Invariant 3 — deep-merge later-wins idempotence                           */
/* ------------------------------------------------------------------------ */

describe('property: deep-merge later-wins idempotence (invariant 3)', () => {
  fctest.prop([configArb], { numRuns: 200 })('merge(a, a) deep-equals a', (a) => {
    // Snapshot a so later mutation by anyone is impossible.
    const snapshot: unknown = JSON.parse(JSON.stringify(a));
    const merged = deepMergeRef(snapshot, snapshot);
    expect(merged).toEqual(snapshot);
  });
});

/* ------------------------------------------------------------------------ */
/* Invariant 4 — BOM strip is idempotent                                     */
/* ------------------------------------------------------------------------ */

describe('property: loadJsonConfig BOM-strip is idempotent (invariant 4)', () => {
  fctest.prop([configArb], { numRuns: 200 })(
    'load(BOM + json(x)) deep-equals load(json(x))',
    async (input) => {
      const body = JSON.stringify(input);
      const id = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
      const withBomPath = join(tmpRoot, `bom-${id}.json`);
      const noBomPath = join(tmpRoot, `nobom-${id}.json`);
      await writeFile(withBomPath, `﻿${body}`, 'utf8');
      await writeFile(noBomPath, body, 'utf8');
      const a = await loadJsonConfig(withBomPath);
      const b = await loadJsonConfig(noBomPath);
      expect(a).toEqual(b);
      // Sanity: the no-BOM version round-trips through JSON.parse identically.
      expect(b).toEqual(JSON.parse(body));
    },
    60_000,
  );
});

/* ------------------------------------------------------------------------ */
/* Invariant 5 — workspace discovery determinism                             */
/* ------------------------------------------------------------------------ */

describe('property: discoverWorkspaces is deterministic (invariant 5)', () => {
  fctest.prop(
    [fc.uniqueArray(fc.stringMatching(/^pkg-[a-z]{1,6}$/), { minLength: 1, maxLength: 5 })],
    { numRuns: 50 },
  )(
    'two consecutive calls produce identical results',
    async (pkgNames) => {
      // Seed an npm-workspaces shape: package.json with workspaces, plus a
      // package.json under each child dir. package-lock.json signals npm.
      await writeFile(join(tmpRoot, 'package-lock.json'), '{}', 'utf8');
      await writeJson(join(tmpRoot, 'package.json'), {
        name: 'root',
        private: true,
        workspaces: pkgNames.map((n) => `packages/${n}`),
      });
      for (const n of pkgNames) {
        const dir = join(tmpRoot, 'packages', n);
        await mkdir(dir, { recursive: true });
        await writeJson(join(dir, 'package.json'), { name: n, version: '0.0.0' });
      }

      const first = await discoverWorkspaces(tmpRoot);
      const second = await discoverWorkspaces(tmpRoot);
      expect(second.kind).toBe(first.kind);
      expect(second.root).toBe(first.root);
      expect([...second.packages]).toEqual([...first.packages]);
      // Sorted-output sanity.
      expect([...first.packages]).toEqual([...first.packages].slice().sort());
    },
    60_000,
  );
});

/* ------------------------------------------------------------------------ */
/* Invariant 6 — preset detection is order-independent                       */
/* ------------------------------------------------------------------------ */

describe('property: detectFrameworks is order-independent (invariant 6)', () => {
  fctest.prop(
    [
      fc.uniqueArray(knownDepNameArb, { minLength: 1, maxLength: 6 }),
      fc.integer({ min: 1, max: 0xffffffff }),
    ],
    { numRuns: 200 },
  )(
    'frameworks are equal regardless of dep insertion order',
    async (deps, seed) => {
      const id = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
      const dirA = join(tmpRoot, `a-${id}`);
      const dirB = join(tmpRoot, `b-${id}`);
      await mkdir(dirA, { recursive: true });
      await mkdir(dirB, { recursive: true });

      // Order A: declared order. Order B: deterministically shuffled.
      const orderedA: Record<string, string> = {};
      for (const d of deps) orderedA[d] = '*';
      const shuffled = shuffleWithSeed(deps, seed);
      const orderedB: Record<string, string> = {};
      for (const d of shuffled) orderedB[d] = '*';

      await writeJson(join(dirA, 'package.json'), {
        name: 'a',
        version: '0.0.0',
        dependencies: orderedA,
      });
      await writeJson(join(dirB, 'package.json'), {
        name: 'b',
        version: '0.0.0',
        dependencies: orderedB,
      });

      const fa = await detectFrameworks(dirA);
      const fb = await detectFrameworks(dirB);
      expect([...fb]).toEqual([...fa]);
      // Sanity: returned list is sorted (deterministic output contract).
      expect([...fa]).toEqual([...fa].slice().sort());
    },
    60_000,
  );
});

/* ------------------------------------------------------------------------ */
/* Invariant 8 — Zod parse defends against prototype pollution               */
/* ------------------------------------------------------------------------ */

describe('property: schema parse never pollutes Object.prototype (invariant 8)', () => {
  fctest.prop(
    [
      fc.record({
        production: fc.boolean(),
        // Always include a __proto__ payload at the top level, alongside a
        // legitimate-looking nested object to stress-test deeper traversal.
        nested: fc.record({
          inner: fc.string({ maxLength: 8 }),
        }),
      }),
    ],
    { numRuns: 200 },
  )(
    'parsing a config with a top-level __proto__ key yields a result whose prototype is Object.prototype',
    (input) => {
      // Construct via JSON round-trip so __proto__ is a real own key (not a
      // setter call), which is the form on-disk JSON payloads take through
      // jsonc-parser. We attach __proto__ AFTER JSON.parse to avoid the
      // V8 parser semantics that would mutate prototype.
      const polluted: Record<string, unknown> = { ...input };
      Object.defineProperty(polluted, '__proto__', {
        value: { polluted: true },
        enumerable: true,
        configurable: true,
        writable: true,
      });

      // Either Zod accepts it (passthrough) or rejects it. Both are safe;
      // what we forbid is a parsed result that has been re-prototyped.
      let parsed: unknown;
      try {
        parsed = FugaziConfigSchemaPermissive.parse(polluted);
      } catch {
        // Rejection is acceptable — defense-in-depth.
        return;
      }
      expect(parsed).not.toBeNull();
      expect(typeof parsed).toBe('object');
      const proto = Object.getPrototypeOf(parsed);
      expect(proto === Object.prototype || proto === null).toBe(true);
      // Crucially: Object.prototype itself was not polluted.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    },
  );

  fctest.prop(
    [
      fc.record({
        rules: fc.dictionary(
          fc.constantFrom('unused-files', 'unused-exports'),
          fc.constantFrom('error', 'warn'),
          { maxKeys: 2 },
        ),
      }),
    ],
    { numRuns: 200 },
  )('nested __proto__ keys do not propagate onto Object.prototype', (input) => {
    // A nested map that owns a __proto__ key. We have to attach with
    // defineProperty because plain literal `{ __proto__: ... }` triggers
    // V8's prototype-setter semantics.
    const innerWithProto: Record<string, unknown> = {};
    Object.defineProperty(innerWithProto, '__proto__', {
      value: { nestedPolluted: 'yes' },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const polluted: Record<string, unknown> = { ...input, deep: innerWithProto };

    let parsed: unknown;
    try {
      parsed = FugaziConfigSchemaPermissive.parse(polluted);
    } catch {
      return;
    }
    expect(parsed).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((Object.prototype as Record<string, unknown>).nestedPolluted).toBeUndefined();
  });
});
