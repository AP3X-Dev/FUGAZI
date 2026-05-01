import { describe, expect, it } from 'vitest';
import { processCache } from '../process-cache.js';

describe('processCache', () => {
  it('calls the loader once per unique key across N sequential callers', async () => {
    let calls = 0;
    const loader = async (k: string): Promise<string> => {
      calls += 1;
      return `value:${k}`;
    };
    const cached = processCache(loader);

    expect(await cached('a')).toBe('value:a');
    expect(await cached('a')).toBe('value:a');
    expect(await cached('a')).toBe('value:a');
    expect(calls).toBe(1);
  });

  it('dedups in-flight calls: 10 concurrent callers with the same key call the loader exactly once', async () => {
    let calls = 0;
    let resolveLoader: (value: string) => void = () => {};
    const loaderPromise = new Promise<string>((resolve) => {
      resolveLoader = resolve;
    });
    const loader = async (_k: string): Promise<string> => {
      calls += 1;
      return loaderPromise;
    };
    const cached = processCache(loader);

    const callers = Array.from({ length: 10 }, () => cached('shared-key'));
    // All callers should be sharing the same in-flight promise.
    expect(calls).toBe(1);

    resolveLoader('resolved-value');
    const results = await Promise.all(callers);
    expect(results).toEqual(Array.from({ length: 10 }, () => 'resolved-value'));
    expect(calls).toBe(1);
  });

  it('10 callers across 5 keys (each repeated twice) → loader called exactly 5 times', async () => {
    let calls = 0;
    const loader = async (k: string): Promise<string> => {
      calls += 1;
      // small await to interleave
      await Promise.resolve();
      return `v:${k}`;
    };
    const cached = processCache(loader);

    const keys = ['a', 'b', 'c', 'd', 'e', 'a', 'b', 'c', 'd', 'e'];
    const results = await Promise.all(keys.map((k) => cached(k)));
    expect(results).toEqual(keys.map((k) => `v:${k}`));
    expect(calls).toBe(5);
  });

  it('caches rejected promises: a rejecting loader is called exactly once even after rejection surfaces', async () => {
    let calls = 0;
    const failure = new Error('loader-failed');
    const loader = async (_k: string): Promise<string> => {
      calls += 1;
      throw failure;
    };
    const cached = processCache(loader);

    await expect(cached('x')).rejects.toBe(failure);
    await expect(cached('x')).rejects.toBe(failure);
    await expect(cached('x')).rejects.toBe(failure);
    expect(calls).toBe(1);
  });

  it('subsequent calls receive the same rejected promise (referential equality)', async () => {
    const failure = new Error('boom');
    const loader = async (_k: string): Promise<string> => {
      throw failure;
    };
    const cached = processCache(loader);

    const p1 = cached('k');
    const p2 = cached('k');
    expect(p1).toBe(p2);
    await expect(p1).rejects.toBe(failure);
    await expect(p2).rejects.toBe(failure);
  });

  it('different keys are independent', async () => {
    const seen: string[] = [];
    const loader = async (k: string): Promise<number> => {
      seen.push(k);
      return k.length;
    };
    const cached = processCache(loader);

    expect(await cached('aa')).toBe(2);
    expect(await cached('bbb')).toBe(3);
    expect(await cached('aa')).toBe(2);
    expect(await cached('bbb')).toBe(3);
    expect(seen).toEqual(['aa', 'bbb']);
  });

  it('supports non-string keys (e.g. number)', async () => {
    let calls = 0;
    const loader = async (k: number): Promise<number> => {
      calls += 1;
      return k * 2;
    };
    const cached = processCache(loader);

    expect(await cached(1)).toBe(2);
    expect(await cached(2)).toBe(4);
    expect(await cached(1)).toBe(2);
    expect(calls).toBe(2);
  });
});
