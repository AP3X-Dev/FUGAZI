/**
 * extends-chain.test.ts — T038-test for the `extends` chain resolver (T039).
 *
 * Covers:
 *   - happy paths: linear local chain, branching (array of parents),
 *     no-extends pass-through, single-string extends, cross-extension chain
 *     (.json → .toml → .ts), node_modules acceptance.
 *   - security boundaries: depth cap (≥10), cycle detection, path-traversal
 *     guard, prototype-pollution guard (__proto__, constructor, prototype),
 *     protocol guard (https-only), unsupported extension.
 *   - remote: timeout, size cap, non-200, parse error, single-fetch caching
 *     within one resolution. We inject a stub `fetch` impl rather than
 *     spinning up a real HTTPS server (no extra deps, deterministic, fast).
 *
 * Verbatim error strings (per E5) are pinned as exact matches.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FugaziConfigError } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import { resolveExtendsChain } from '../extends-chain.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '..', '..', 'test', 'fixtures', 'extends');

/**
 * Build a fake fetch that returns the given body/status/headers for a URL.
 * Used to exercise the remote-extends branches without network I/O.
 */
function makeStubFetch(
  responses: Record<
    string,
    {
      readonly body?: string;
      readonly status?: number;
      readonly delayMs?: number;
      readonly oversize?: boolean;
    }
  >,
): typeof fetch {
  // Cast through unknown to satisfy the Fetch generic without dragging the
  // entire DOM type into our config sources.
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const cfg = responses[url];
    if (!cfg) throw new Error(`stub fetch: no response configured for ${url}`);

    if (cfg.delayMs !== undefined) {
      // Honour the AbortSignal — abort means we throw a DOMException-like
      // error with name 'AbortError' so the production code's catch can
      // recognise the timeout.
      await new Promise<void>((resolveDelay, rejectDelay) => {
        const t = setTimeout(resolveDelay, cfg.delayMs);
        const sig = init?.signal;
        if (sig) {
          if (sig.aborted) {
            clearTimeout(t);
            const e = new Error('aborted');
            (e as Error & { name: string }).name = 'AbortError';
            rejectDelay(e);
            return;
          }
          sig.addEventListener('abort', () => {
            clearTimeout(t);
            const e = new Error('aborted');
            (e as Error & { name: string }).name = 'AbortError';
            rejectDelay(e);
          });
        }
      });
    }

    const status = cfg.status ?? 200;
    const body = cfg.body ?? '';

    // For oversize tests, return a body that's larger than 1MB.
    const finalBody = cfg.oversize ? 'x'.repeat(1_000_001) : body;
    const buf = new TextEncoder().encode(finalBody);

    // Build a streamed Response so the resolver's byte-counting reader sees
    // multiple chunks. ReadableStream is available in Node 22+ globalThis.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(buf);
        controller.close();
      },
    });

    return new Response(stream, { status });
  }) as unknown as typeof fetch;
}

describe('resolveExtendsChain — no extends pass-through', () => {
  it('returns the config unchanged when there is no extends field', async () => {
    const path = resolve(FIXTURES, 'no-extends', 'a.json');
    const config = { rules: { 'unused-files': 'error' }, production: true } as const;
    const result = await resolveExtendsChain(path, config);
    expect(result).toEqual({ rules: { 'unused-files': 'error' }, production: true });
  });
});

describe('resolveExtendsChain — local file chains', () => {
  it('resolves a 3-level linear chain a → b → c with deep-merge', async () => {
    const path = resolve(FIXTURES, 'local-chain', 'a.json');
    const config = {
      extends: './b.json',
      rules: { 'unused-exports': 'warn' },
      production: true,
    } as const;
    const result = (await resolveExtendsChain(path, config)) as Record<string, unknown>;
    // Deep-merge: c.rules + b.rules + a.rules → a wins on conflicts.
    expect(result.rules).toEqual({
      'unused-files': 'error', // c had warn, b had error → b wins, a doesn't override
      'unused-exports': 'warn', // c had error, a had warn → a wins (overlays last)
    });
    expect(result.include).toEqual(['src/**/*.ts']); // from c, untouched
    expect(result.exclude).toEqual(['dist']); // from b, untouched
    expect(result.production).toBe(true); // a wins
    // The merged result must NOT carry the extends field.
    expect(result.extends).toBeUndefined();
  });

  it('accepts a single-string extends ref (not just arrays)', async () => {
    const path = resolve(FIXTURES, 'single-string', 'child.json');
    const config = { extends: './parent.json', production: true } as const;
    const result = (await resolveExtendsChain(path, config)) as Record<string, unknown>;
    expect(result.rules).toEqual({ 'unused-files': 'warn' });
    expect(result.include).toEqual(['src/**/*.ts']);
    expect(result.production).toBe(true);
  });

  it('resolves a branching extends array with later-parent-wins precedence', async () => {
    const path = resolve(FIXTURES, 'branching', 'child.json');
    const config = {
      extends: ['./p1.json', './p2.json', './p3.json'],
      rules: { 'circular-dependencies': 'error' },
    } as const;
    const result = (await resolveExtendsChain(path, config)) as Record<string, unknown>;
    // unused-files: p1=warn, p2=error, p3=off → p3 wins (last parent), child doesn't set it.
    // unused-exports: only p1 set it → carries through.
    // unused-types: only p2 set it → carries through.
    // unused-deps: only p3 set it → carries through.
    // circular-dependencies: only child sets it.
    expect(result.rules).toEqual({
      'unused-files': 'off',
      'unused-exports': 'warn',
      'unused-types': 'warn',
      'unused-deps': 'error',
      'circular-dependencies': 'error',
    });
    // include: scalar/array — overlay-replace. p3 didn't set it, p2 did, p1 did.
    // p2 overrides p1; p3 doesn't define it; child doesn't define it.
    expect(result.include).toEqual(['from-p2/**/*.ts']);
    // production: p3 set true, child doesn't override → true.
    expect(result.production).toBe(true);
  });

  it('resolves a mixed-extension chain (.json → .toml → .ts)', async () => {
    const path = resolve(FIXTURES, 'cross-extension', 'a.json');
    const config = { extends: './b.toml', production: true } as const;
    const result = (await resolveExtendsChain(path, config)) as Record<string, unknown>;
    // c.ts: include=['from-ts/**/*.ts'], rules.unused-files=warn
    // b.toml: extends c.ts, rules.unused-files=error → overrides
    // a.json: extends b.toml, production=true
    expect(result.rules).toEqual({ 'unused-files': 'error' });
    expect(result.include).toEqual(['from-ts/**/*.ts']);
    expect(result.production).toBe(true);
  });

  it('accepts an extends path that lives inside node_modules', async () => {
    const path = resolve(FIXTURES, 'node-modules-deep', 'a.json');
    const config = {
      extends: './node_modules/shared-config/preset.json',
      include: ['src/**/*.ts'],
    } as const;
    const result = (await resolveExtendsChain(path, config)) as Record<string, unknown>;
    expect(result.rules).toEqual({ 'unused-files': 'error', 'unused-exports': 'error' });
    expect(result.production).toBe(true);
    expect(result.include).toEqual(['src/**/*.ts']);
  });
});

describe('resolveExtendsChain — depth cap and cycle detection', () => {
  it('throws CONFIG_EXTENDS_DEPTH_EXCEEDED on a chain deeper than 10', async () => {
    const path = resolve(FIXTURES, 'depth-overflow', 'd0.json');
    const config = { extends: './d1.json' } as const;
    let caught: unknown;
    try {
      await resolveExtendsChain(path, config);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziConfigError);
    const e = caught as FugaziConfigError;
    expect(e.code).toBe('CONFIG_EXTENDS_DEPTH_EXCEEDED');
    expect(e.message.startsWith('extends: chain depth ≥ 10 at ')).toBe(true);
  });

  it('throws CONFIG_EXTENDS_DEPTH_EXCEEDED on a cycle a → b → a', async () => {
    const path = resolve(FIXTURES, 'cycle', 'a.json');
    const config = { extends: './b.json', rules: { 'unused-files': 'error' } } as const;
    let caught: unknown;
    try {
      await resolveExtendsChain(path, config);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziConfigError);
    const e = caught as FugaziConfigError;
    expect(e.code).toBe('CONFIG_EXTENDS_DEPTH_EXCEEDED');
    expect(e.message.startsWith('extends: chain depth ≥ 10 at ')).toBe(true);
  });
});

describe('resolveExtendsChain — protocol guard (IMP-SEC-05)', () => {
  it("rejects http:// with verbatim 'only https:// is allowed' message", async () => {
    const path = resolve(FIXTURES, 'no-extends', 'a.json');
    const config = { extends: 'http://example.com/preset.json' } as const;
    let caught: unknown;
    try {
      await resolveExtendsChain(path, config);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziConfigError);
    const e = caught as FugaziConfigError;
    expect(e.code).toBe('CONFIG_EXTENDS_PROTOCOL_REJECTED');
    expect(e.message).toBe("extends: only https:// is allowed for remote configs, got 'http'");
  });

  it('rejects file:// with a protocol error', async () => {
    const path = resolve(FIXTURES, 'no-extends', 'a.json');
    const config = { extends: 'file:///etc/passwd' } as const;
    let caught: unknown;
    try {
      await resolveExtendsChain(path, config);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziConfigError);
    const e = caught as FugaziConfigError;
    expect(e.code).toBe('CONFIG_EXTENDS_PROTOCOL_REJECTED');
    expect(e.message).toBe("extends: only https:// is allowed for remote configs, got 'file'");
  });

  it('rejects git:// with a protocol error', async () => {
    const path = resolve(FIXTURES, 'no-extends', 'a.json');
    const config = { extends: 'git://example.com/preset.json' } as const;
    let caught: unknown;
    try {
      await resolveExtendsChain(path, config);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziConfigError);
    const e = caught as FugaziConfigError;
    expect(e.code).toBe('CONFIG_EXTENDS_PROTOCOL_REJECTED');
    expect(e.message).toBe("extends: only https:// is allowed for remote configs, got 'git'");
  });
});

describe('resolveExtendsChain — path-traversal guard (IMP-SEC-04)', () => {
  it("rejects '../../../../../../etc/passwd' with verbatim path-traversal message", async () => {
    const path = resolve(FIXTURES, 'path-traversal', 'a.json');
    const config = { extends: '../../../../../../../../etc/passwd' } as const;
    let caught: unknown;
    try {
      await resolveExtendsChain(path, config);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziConfigError);
    const e = caught as FugaziConfigError;
    expect(e.code).toBe('CONFIG_PATH_TRAVERSAL');
    // The resolved path includes the platform-specific drive prefix on
    // Windows; we assert the prefix and suffix to keep the test portable.
    expect(e.message.startsWith("extends: path traversal blocked: '")).toBe(true);
    expect(e.message.endsWith("' is outside workspace and node_modules")).toBe(true);
  });
});

describe('resolveExtendsChain — prototype-pollution guard (IMP-SEC-08)', () => {
  it("rejects __proto__ key with verbatim 'refusing to merge dangerous key' message", async () => {
    const path = resolve(FIXTURES, 'proto-pollution', 'child.json');
    const config = { extends: './parent-proto.json', production: true } as const;
    let caught: unknown;
    try {
      await resolveExtendsChain(path, config);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziConfigError);
    const e = caught as FugaziConfigError;
    expect(e.code).toBe('CONFIG_PROTOTYPE_POLLUTION');
    const parentPath = resolve(FIXTURES, 'proto-pollution', 'parent-proto.json');
    expect(e.message).toBe(
      `extends: refusing to merge dangerous key '__proto__' from '${parentPath}'`,
    );
  });

  it('rejects constructor key', async () => {
    const path = resolve(FIXTURES, 'proto-pollution', 'parent-ctor.json');
    const config = {
      extends: undefined,
      // Inline payload simulating what a parent might contain.
      rules: { 'unused-files': 'error' },
      constructor: { prototype: { polluted: true } },
    } as const;
    let caught: unknown;
    try {
      await resolveExtendsChain(path, config);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziConfigError);
    const e = caught as FugaziConfigError;
    expect(e.code).toBe('CONFIG_PROTOTYPE_POLLUTION');
    expect(e.message).toBe(`extends: refusing to merge dangerous key 'constructor' from '${path}'`);
  });

  it('rejects prototype key', async () => {
    const path = resolve(FIXTURES, 'proto-pollution', 'parent-prototype.json');
    const config = {
      rules: { 'unused-files': 'error' },
      prototype: { polluted: true },
    } as const;
    let caught: unknown;
    try {
      await resolveExtendsChain(path, config);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziConfigError);
    const e = caught as FugaziConfigError;
    expect(e.code).toBe('CONFIG_PROTOTYPE_POLLUTION');
    expect(e.message).toBe(`extends: refusing to merge dangerous key 'prototype' from '${path}'`);
  });

  it('does NOT pollute Object.prototype after a rejection', async () => {
    const path = resolve(FIXTURES, 'proto-pollution', 'child.json');
    const config = { extends: './parent-proto.json' } as const;
    try {
      await resolveExtendsChain(path, config);
    } catch {
      // expected
    }
    // If the merge had happened, Object.prototype.polluted would be defined.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('resolveExtendsChain — unsupported extension', () => {
  it('rejects an unsupported config extension with verbatim message', async () => {
    const path = resolve(FIXTURES, 'unsupported-ext', 'a.json');
    const config = { extends: './preset.yaml' } as const;
    let caught: unknown;
    try {
      await resolveExtendsChain(path, config);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziConfigError);
    const e = caught as FugaziConfigError;
    expect(e.code).toBe('CONFIG_PARSE_FAILED');
    expect(e.message).toBe("extends: unsupported config extension: '.yaml'");
  });
});

describe('resolveExtendsChain — remote https (injected fetch)', () => {
  const ROOT = resolve(FIXTURES, 'no-extends', 'a.json');

  it('fetches and merges a remote https config', async () => {
    const url = 'https://example.com/preset.json';
    const fetchImpl = makeStubFetch({
      [url]: {
        body: JSON.stringify({ rules: { 'unused-files': 'warn' }, production: true }),
        status: 200,
      },
    });
    const config = { extends: url, rules: { 'unused-exports': 'error' } } as const;
    const result = (await resolveExtendsChain(ROOT, config, { fetchImpl })) as Record<
      string,
      unknown
    >;
    expect(result.rules).toEqual({ 'unused-files': 'warn', 'unused-exports': 'error' });
    expect(result.production).toBe(true);
  });

  it('rejects non-200 responses with verbatim status message', async () => {
    const url = 'https://example.com/missing.json';
    const fetchImpl = makeStubFetch({ [url]: { status: 404, body: 'not found' } });
    const config = { extends: url } as const;
    let caught: unknown;
    try {
      await resolveExtendsChain(ROOT, config, { fetchImpl });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziConfigError);
    const e = caught as FugaziConfigError;
    expect(e.code).toBe('CONFIG_PARSE_FAILED');
    expect(e.message).toBe(`extends: remote config returned HTTP 404 for '${url}'`);
  });

  it('rejects responses larger than 1MB with verbatim size-cap message', async () => {
    const url = 'https://example.com/big.json';
    const fetchImpl = makeStubFetch({ [url]: { oversize: true, status: 200 } });
    const config = { extends: url } as const;
    let caught: unknown;
    try {
      await resolveExtendsChain(ROOT, config, { fetchImpl });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziConfigError);
    const e = caught as FugaziConfigError;
    expect(e.code).toBe('CONFIG_PARSE_FAILED');
    expect(e.message).toBe(`extends: remote config exceeds 1MB size cap: '${url}'`);
  });

  it('rejects timeouts with verbatim 10-second timeout message', async () => {
    const url = 'https://example.com/slow.json';
    const fetchImpl = makeStubFetch({
      [url]: { delayMs: 60_000, body: '{}', status: 200 },
    });
    const config = { extends: url } as const;
    let caught: unknown;
    try {
      // Override the timeout to 50ms so the test runs fast; production stays at 10s.
      await resolveExtendsChain(ROOT, config, { fetchImpl, fetchTimeoutMs: 50 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziConfigError);
    const e = caught as FugaziConfigError;
    expect(e.code).toBe('CONFIG_PARSE_FAILED');
    expect(e.message).toBe(`extends: timed out fetching '${url}' after 10 seconds`);
  });

  it('rejects malformed remote JSON with CONFIG_PARSE_FAILED', async () => {
    const url = 'https://example.com/bad.json';
    const fetchImpl = makeStubFetch({ [url]: { body: '{not json', status: 200 } });
    const config = { extends: url } as const;
    let caught: unknown;
    try {
      await resolveExtendsChain(ROOT, config, { fetchImpl });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FugaziConfigError);
    const e = caught as FugaziConfigError;
    expect(e.code).toBe('CONFIG_PARSE_FAILED');
  });

  it('caches a single URL across multiple references in one resolution', async () => {
    let fetches = 0;
    const url = 'https://example.com/shared.json';
    const baseImpl = makeStubFetch({
      [url]: {
        body: JSON.stringify({ rules: { 'unused-files': 'error' } }),
        status: 200,
      },
    });
    const counted = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      fetches += 1;
      return baseImpl(input, init);
    }) as typeof fetch;

    // Reference the same URL twice via an array of extends.
    const config = { extends: [url, url], production: true } as const;
    await resolveExtendsChain(ROOT, config, { fetchImpl: counted });
    expect(fetches).toBe(1);
  });
});

describe('resolveExtendsChain — determinism', () => {
  it('produces the same result for repeated calls on the same chain', async () => {
    const path = resolve(FIXTURES, 'local-chain', 'a.json');
    const config = {
      extends: './b.json',
      rules: { 'unused-exports': 'warn' },
      production: true,
    } as const;
    const a = await resolveExtendsChain(path, config);
    const b = await resolveExtendsChain(path, config);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
