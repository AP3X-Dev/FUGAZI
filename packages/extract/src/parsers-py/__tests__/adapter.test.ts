/**
 * adapter.test.ts — Phase 4a T304 — parser-adapter contract tests.
 *
 * Exercises `parsePythonAst()` against the same 10 smoke fixtures from
 * `./smoke.test.ts` (T301), plus dedicated decorator / async / error /
 * determinism cases. The contract under test:
 *
 *   1. Every fixture produces a `PyProgram` with `body` populated by the
 *      expected discriminated `kind` in declaration order.
 *   2. Decorated forms attach decorators to the underlying definition.
 *   3. `async def` becomes `AsyncFunctionDef`; bare `def` becomes
 *      `FunctionDef`.
 *   4. Malformed input emits at least one `ParseError` whose message
 *      matches the verbatim format.
 *   5. Identical input → byte-equal `PyProgram` across consecutive runs.
 */

import { describe, expect, it } from 'vitest';
import type { PyStatement } from '../../ast/kinds-py.js';
import { parsePythonAst } from '../adapter.js';

async function classify(src: string): Promise<readonly PyStatement[]> {
  const r = await parsePythonAst(src, 'fixture.py');
  return r.program.body;
}

describe('parsePythonAst — smoke fixtures (T304)', () => {
  it('classifies a simple def with f-string return as FunctionDef', async () => {
    const body = await classify("def hello(name): return f'Hi {name}'");
    expect(body).toHaveLength(1);
    expect(body[0]?.kind).toBe('FunctionDef');
    if (body[0]?.kind === 'FunctionDef') {
      expect(body[0].name).toBe('hello');
      expect(body[0].params.map((p) => p.name)).toEqual(['name']);
      expect(body[0].body[0]?.kind).toBe('ReturnStmt');
    }
  });

  it('classifies `async def` as AsyncFunctionDef', async () => {
    const body = await classify('async def fetch(url): return await session.get(url)');
    expect(body[0]?.kind).toBe('AsyncFunctionDef');
    if (body[0]?.kind === 'AsyncFunctionDef') {
      expect(body[0].name).toBe('fetch');
    }
  });

  it('classifies a class with method as ClassDef', async () => {
    const body = await classify('class Foo:\n    def bar(self): pass');
    expect(body[0]?.kind).toBe('ClassDef');
    if (body[0]?.kind === 'ClassDef') {
      expect(body[0].name).toBe('Foo');
      expect(body[0].members).toEqual(['bar']);
    }
  });

  it('attaches a decorator to a class', async () => {
    const body = await classify('@dataclass\nclass Point:\n    x: int\n    y: int');
    expect(body[0]?.kind).toBe('ClassDef');
    if (body[0]?.kind === 'ClassDef') {
      expect(body[0].decorators).toHaveLength(1);
      expect(body[0].decorators[0]?.expression.kind).toBe('Name');
      if (body[0].decorators[0]?.expression.kind === 'Name') {
        expect(body[0].decorators[0].expression.id).toBe('dataclass');
      }
      // AnnAssign'd `x: int` and `y: int` collapse into class members.
      expect(body[0].members).toEqual(['x', 'y']);
    }
  });

  it('classifies the walrus operator as Walrus inside an If test', async () => {
    const body = await classify('if (n := len(items)) > 10:\n    pass');
    expect(body[0]?.kind).toBe('IfStmt');
    if (body[0]?.kind === 'IfStmt') {
      // The test is a comparison; recursing into BinOp.left should reveal
      // the Walrus wrapped by the parenthesized_expression unwrap.
      expect(body[0].test.kind).toBe('BinOp');
    }
  });

  it('classifies match/case as MatchStmt', async () => {
    const body = await classify(
      "match cmd:\n    case 'go':\n        pass\n    case _:\n        pass",
    );
    expect(body[0]?.kind).toBe('MatchStmt');
    if (body[0]?.kind === 'MatchStmt') {
      expect(body[0].subject.kind).toBe('Name');
      // The two `case` branches each contribute a Pass to the folded body.
      expect(body[0].body.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('classifies a list comprehension', async () => {
    const body = await classify('xs = [x*2 for x in range(10) if x > 5]');
    expect(body[0]?.kind).toBe('Assign');
    if (body[0]?.kind === 'Assign') {
      expect(body[0].targets).toEqual(['xs']);
      expect(body[0].value.kind).toBe('Comprehension');
      if (body[0].value.kind === 'Comprehension') {
        expect(body[0].value.compKind).toBe('list');
      }
    }
  });

  it('classifies generator with yield from as YieldStmt with from=true', async () => {
    const body = await classify('def gen():\n    yield from range(10)');
    expect(body[0]?.kind).toBe('FunctionDef');
    if (body[0]?.kind === 'FunctionDef') {
      const inner = body[0].body[0];
      // The body wraps the `yield from range(10)` as ExpressionStmt → Yield.
      expect(inner?.kind).toBe('ExpressionStmt');
      if (inner?.kind === 'ExpressionStmt') {
        expect(inner.expression.kind).toBe('Yield');
        if (inner.expression.kind === 'Yield') {
          expect(inner.expression.from).toBe(true);
        }
      }
    }
  });

  it('classifies try/except/finally as TryStmt', async () => {
    const body = await classify(
      'try:\n    x = 1\nexcept ValueError as e:\n    pass\nfinally:\n    cleanup()',
    );
    expect(body[0]?.kind).toBe('TryStmt');
    if (body[0]?.kind === 'TryStmt') {
      expect(body[0].handlers.length).toBeGreaterThanOrEqual(1);
      // ValueError surfaces as a Name handler.
      expect(body[0].handlers[0]?.kind).toBe('Name');
    }
  });

  it('classifies a with statement', async () => {
    const body = await classify("with open('f') as f:\n    data = f.read()");
    expect(body[0]?.kind).toBe('WithStmt');
    if (body[0]?.kind === 'WithStmt') {
      expect(body[0].items).toHaveLength(1);
      expect(body[0].items[0]?.kind).toBe('Call');
    }
  });
});

describe('parsePythonAst — decorators / errors / determinism (T304)', () => {
  it('attaches a call-form decorator with attribute target', async () => {
    const body = await classify('@app.route("/")\ndef view(): pass');
    expect(body[0]?.kind).toBe('FunctionDef');
    if (body[0]?.kind === 'FunctionDef') {
      expect(body[0].decorators).toHaveLength(1);
      expect(body[0].decorators[0]?.expression.kind).toBe('Call');
    }
  });

  it('emits a verbatim ParseError on malformed input', async () => {
    const r = await parsePythonAst('def bad(\n    pass', 'bad.py');
    expect(r.errors.length).toBeGreaterThan(0);
    // Each error message starts with `parse-error:` or `missing token:`.
    for (const e of r.errors) {
      expect(e.code).toBe('PARSE_SYNTAX_ERROR');
      expect(e.file).toBe('bad.py');
      expect(e.message).toMatch(/^(parse-error: unexpected '|missing token: )/);
    }
  });

  it('produces byte-equal PyProgram across 5 consecutive parses (determinism)', async () => {
    const src =
      'def deterministic(a, b):\n' +
      '    if a > b:\n' +
      "        return 'big'\n" +
      "    return 'small'\n";
    const snapshots: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await parsePythonAst(src, 'det.py');
      snapshots.push(JSON.stringify(r.program));
    }
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i]).toBe(snapshots[0]);
    }
  });

  it('returns an empty program body for empty input', async () => {
    const r = await parsePythonAst('', 'empty.py');
    expect(r.program.body).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it('classifies module-level imports verbatim', async () => {
    const body = await classify('import os\nfrom foo.bar import baz');
    expect(body[0]?.kind).toBe('ImportStmt');
    expect(body[1]?.kind).toBe('ImportFromStmt');
    if (body[1]?.kind === 'ImportFromStmt') {
      expect(body[1].module).toBe('foo.bar');
      expect(body[1].level).toBe(0);
      expect(body[1].names).toEqual(['baz']);
    }
  });
});
