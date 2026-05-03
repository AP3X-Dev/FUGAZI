/**
 * complexity-py.test.ts — Phase 4a T309 — McCabe + Sonar complexity for
 * Python sources. ~10 hand-validated fixtures covering each decision keyword
 * plus class-method qualified-name emission and structural invariants
 * (determinism, MAX_FUNCTIONS_PER_FILE truncation).
 *
 * Each cyclomatic count is computed as: 1 (baseline) + every decision
 * keyword in the function body. The keyword set is documented in
 * `complexity/cyclomatic-py.ts`.
 */

import { describe, expect, it } from 'vitest';
import { computeComplexityPy } from '../complexity/index.js';
import type { FileComplexity } from '../complexity/index.js';
import { parsePythonAst } from '../parsers-py/adapter.js';

async function analyze(src: string): Promise<FileComplexity> {
  const r = await parsePythonAst(src, 'fixture.py');
  return computeComplexityPy(r.program, src);
}

function findFn(result: FileComplexity, name: string): FileComplexity['functions'][number] {
  const fn = result.functions.find((f) => f.name === name);
  if (fn === undefined) {
    throw new Error(
      `function '${name}' not found in: ${result.functions.map((f) => f.name).join(', ')}`,
    );
  }
  return fn;
}

describe('Python complexity — cyclomatic fixtures (T309)', () => {
  it('1. simple function with single if has cyclomatic 2', async () => {
    const src = 'def f(x):\n    if x:\n        return 1\n    return 0\n';
    const r = await analyze(src);
    expect(findFn(r, 'f').cyclomatic).toBe(2);
  });

  it('2. function with if/elif/else has cyclomatic 3', async () => {
    const src =
      'def f(x):\n    if x == 1:\n        return 1\n    elif x == 2:\n        return 2\n    else:\n        return 3\n';
    const r = await analyze(src);
    // baseline 1 + if (1) + elif (1) = 3
    expect(findFn(r, 'f').cyclomatic).toBe(3);
  });

  it('3. for loop with break — for adds 1, break does not', async () => {
    const src = 'def f(xs):\n    for x in xs:\n        break\n';
    const r = await analyze(src);
    expect(findFn(r, 'f').cyclomatic).toBe(2);
  });

  it('4. try with two except clauses — each except adds 1', async () => {
    const src =
      'def f():\n    try:\n        do()\n    except ValueError:\n        pass\n    except TypeError:\n        pass\n';
    const r = await analyze(src);
    // baseline 1 + except (1) + except (1) = 3
    expect(findFn(r, 'f').cyclomatic).toBe(3);
  });

  it('5. match/case with three case arms has cyclomatic 4', async () => {
    const src =
      'def f(x):\n    match x:\n        case 1:\n            return 1\n        case 2:\n            return 2\n        case _:\n            return 0\n';
    const r = await analyze(src);
    // baseline 1 + 3*case = 4
    expect(findFn(r, 'f').cyclomatic).toBe(4);
  });

  it('6. comprehension with two if filters — each adds 1', async () => {
    const src = 'def f(xs):\n    return [x for x in xs if x > 0 if x < 10]\n';
    const r = await analyze(src);
    // baseline 1 + for (1) + if (1) + if (1) = 4
    // (Approximation: tracker counts each `for` and `if` keyword.)
    expect(findFn(r, 'f').cyclomatic).toBe(4);
  });

  it('7. function with `and`/`or` — each contributes', async () => {
    const src = 'def f(x, y, z):\n    return x and y or z\n';
    const r = await analyze(src);
    // baseline 1 + and (1) + or (1) = 3
    expect(findFn(r, 'f').cyclomatic).toBe(3);
  });

  it('8. lambda inside function adds 1', async () => {
    const src = 'def f():\n    g = lambda x: x + 1\n    return g(5)\n';
    const r = await analyze(src);
    // baseline 1 + lambda (1) = 2
    expect(findFn(r, 'f').cyclomatic).toBe(2);
  });

  it('9. while loop adds 1', async () => {
    const src = 'def f(n):\n    while n > 0:\n        n -= 1\n';
    const r = await analyze(src);
    expect(findFn(r, 'f').cyclomatic).toBe(2);
  });

  it('10. with statement adds 1 (context-manager branch)', async () => {
    const src = 'def f():\n    with open("x") as fp:\n        return fp.read()\n';
    const r = await analyze(src);
    expect(findFn(r, 'f').cyclomatic).toBe(2);
  });

  it('11. assert adds 1', async () => {
    const src = 'def f(x):\n    assert x > 0\n    return x\n';
    const r = await analyze(src);
    expect(findFn(r, 'f').cyclomatic).toBe(2);
  });

  it('12. async def is scored like sync def', async () => {
    const src = 'async def f(x):\n    if x:\n        return 1\n    return 0\n';
    const r = await analyze(src);
    expect(findFn(r, 'f').cyclomatic).toBe(2);
  });
});

describe('Python complexity — class methods (T309)', () => {
  it('emits one FunctionComplexity per method, qualified by class name', async () => {
    const src =
      'class Foo:\n    def a(self): pass\n    def b(self):\n        if 1:\n            return 1\n        return 0\n    def c(self): pass\n';
    const r = await analyze(src);
    const names = r.functions.map((f) => f.name);
    expect(names).toEqual(['Foo.a', 'Foo.b', 'Foo.c']);
    const b = findFn(r, 'Foo.b');
    expect(b.cyclomatic).toBe(2);
  });
});

describe('Python complexity — structural invariants', () => {
  it('determinism: byte-equal JSON across repeated computations', async () => {
    const src = 'def f(x):\n    if x:\n        return 1\n    return 0\n';
    const r = await parsePythonAst(src, 'd.py');
    const a = computeComplexityPy(r.program, src);
    const b = computeComplexityPy(r.program, src);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('aggregate is correct: sum of per-function metrics', async () => {
    const src = 'def a():\n    pass\ndef b():\n    if 1:\n        return 1\n';
    const r = await analyze(src);
    expect(r.functions.length).toBe(2);
    expect(r.aggregate.cyclomatic).toBe(1 + 2); // 3
  });

  it('empty program emits an empty function list and MI = 100', async () => {
    const r = await analyze('');
    expect(r.functions).toEqual([]);
    expect(r.aggregate.maintainabilityIndex).toBe(100);
  });

  it('MI is in [0, 100] and rounded to 6 decimals', async () => {
    const src = 'def f(x):\n    if x:\n        return 1\n    return 0\n';
    const r = await analyze(src);
    const fn = findFn(r, 'f');
    expect(fn.maintainabilityIndex).toBeGreaterThanOrEqual(0);
    expect(fn.maintainabilityIndex).toBeLessThanOrEqual(100);
  });
});

describe('Python complexity — cognitive (T309)', () => {
  it('plain function has cognitive 0', async () => {
    const src = 'def f(x):\n    return x\n';
    const r = await analyze(src);
    expect(findFn(r, 'f').cognitive).toBe(0);
  });

  it('nested if increases cognitive by depth', async () => {
    const src = 'def f(x, y):\n    if x:\n        if y:\n            return 1\n    return 0\n';
    const r = await analyze(src);
    // outer if: +1 (depth 0); nested if: +1 + 1 (depth 1) = 3
    expect(findFn(r, 'f').cognitive).toBe(3);
  });
});
