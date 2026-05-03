/**
 * kinds-py.test.ts — Phase 4a T303 acceptance suite for the Python
 * discriminated-union AST + walker.
 *
 * Mirrors the discipline of `../../__tests__/ast-kinds.test.ts` (TS/JS
 * variant) and adds 2 cross-language Inventory checks (T302).
 *
 * Coverage:
 *   1..5. Compile-time exhaustiveness via `assertNever` switches over
 *         `PyStatement`, `PyExpression`, and `ASTNodePy`. Type-only checks;
 *         `tsc --noEmit` is the gate. `assertNever` runtime presence test
 *         confirms every variant in this file matches the union.
 *   6..13. `walkPy()` semantics — depth-first, parent tracking, onEnter/
 *          onLeave order, determinism, leaves, every kind walks without
 *          throwing.
 *   14.    Sentinel-absence guard — kinds-py.ts and visit-py.ts contain no
 *          legacy Fallow string sentinel.
 *   15..16. Cross-lang Inventory shape (T302) — TS visitor emits `lang: 'ts'`,
 *           Inventory.lang is the optional discriminator.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNever } from '@fugazi/types';
import type { Range } from '@fugazi/types';
import { describe, expect, it } from 'vitest';
import { buildInventory } from '../../visitor/index.js';
import type { Inventory } from '../../visitor/types.js';
import type { ASTNodePy, PyExpression, PyProgram, PyStatement } from '../kinds-py.js';
import type { Program } from '../kinds.js';
import { childrenOfPy, walkPy } from '../visit-py.js';

// --------------------------------------------------------------------------
// Synthesized helpers — minimal node fixtures for the walker tests so we
// don't depend on the parser for type-level coverage. T304 will populate the
// real adapter.
// --------------------------------------------------------------------------

const ZERO_RANGE: Range = {
  start: { line: 1, column: 0, byteOffset: 0 },
  end: { line: 1, column: 0, byteOffset: 0 },
};

const name = (id: string): PyExpression => ({ kind: 'Name', range: ZERO_RANGE, id });
const constant = (value: string | number | boolean | null): PyExpression => ({
  kind: 'Constant',
  range: ZERO_RANGE,
  value,
});

// --------------------------------------------------------------------------
// 1..3. Compile-time exhaustiveness — `assertNever` on `kind`.
// --------------------------------------------------------------------------

function statementKind(s: PyStatement): string {
  switch (s.kind) {
    case 'AnnAssign':
      return 'AnnAssign';
    case 'Assign':
      return 'Assign';
    case 'AsyncFunctionDef':
      return 'AsyncFunctionDef';
    case 'AugAssign':
      return 'AugAssign';
    case 'Break':
      return 'Break';
    case 'ClassDef':
      return 'ClassDef';
    case 'Continue':
      return 'Continue';
    case 'ExpressionStmt':
      return 'ExpressionStmt';
    case 'ForStmt':
      return 'ForStmt';
    case 'FunctionDef':
      return 'FunctionDef';
    case 'IfStmt':
      return 'IfStmt';
    case 'ImportFromStmt':
      return 'ImportFromStmt';
    case 'ImportStmt':
      return 'ImportStmt';
    case 'MatchStmt':
      return 'MatchStmt';
    case 'Pass':
      return 'Pass';
    case 'RaiseStmt':
      return 'RaiseStmt';
    case 'ReturnStmt':
      return 'ReturnStmt';
    case 'TryStmt':
      return 'TryStmt';
    case 'UnknownStatement':
      return 'UnknownStatement';
    case 'WhileStmt':
      return 'WhileStmt';
    case 'WithStmt':
      return 'WithStmt';
    case 'YieldStmt':
      return 'YieldStmt';
    default:
      return assertNever(s);
  }
}

function expressionKind(e: PyExpression): string {
  switch (e.kind) {
    case 'Attribute':
      return 'Attribute';
    case 'Await':
      return 'Await';
    case 'BinOp':
      return 'BinOp';
    case 'BoolOp':
      return 'BoolOp';
    case 'Call':
      return 'Call';
    case 'Comprehension':
      return 'Comprehension';
    case 'Conditional':
      return 'Conditional';
    case 'Constant':
      return 'Constant';
    case 'Decorator':
      return 'Decorator';
    case 'Dict':
      return 'Dict';
    case 'FString':
      return 'FString';
    case 'Lambda':
      return 'Lambda';
    case 'List':
      return 'List';
    case 'Name':
      return 'Name';
    case 'Set':
      return 'Set';
    case 'Starred':
      return 'Starred';
    case 'Subscript':
      return 'Subscript';
    case 'Tuple':
      return 'Tuple';
    case 'UnaryOp':
      return 'UnaryOp';
    case 'UnknownExpression':
      return 'UnknownExpression';
    case 'Walrus':
      return 'Walrus';
    case 'Yield':
      return 'Yield';
    default:
      return assertNever(e);
  }
}

function astNodeKind(n: ASTNodePy): string {
  switch (n.kind) {
    case 'PyProgram':
      return 'PyProgram';
    case 'AnnAssign':
    case 'Assign':
    case 'AsyncFunctionDef':
    case 'AugAssign':
    case 'Break':
    case 'ClassDef':
    case 'Continue':
    case 'ExpressionStmt':
    case 'ForStmt':
    case 'FunctionDef':
    case 'IfStmt':
    case 'ImportFromStmt':
    case 'ImportStmt':
    case 'MatchStmt':
    case 'Pass':
    case 'RaiseStmt':
    case 'ReturnStmt':
    case 'TryStmt':
    case 'UnknownStatement':
    case 'WhileStmt':
    case 'WithStmt':
    case 'YieldStmt':
      return statementKind(n);
    case 'Attribute':
    case 'Await':
    case 'BinOp':
    case 'BoolOp':
    case 'Call':
    case 'Comprehension':
    case 'Conditional':
    case 'Constant':
    case 'Decorator':
    case 'Dict':
    case 'FString':
    case 'Lambda':
    case 'List':
    case 'Name':
    case 'Set':
    case 'Starred':
    case 'Subscript':
    case 'Tuple':
    case 'UnaryOp':
    case 'UnknownExpression':
    case 'Walrus':
    case 'Yield':
      return expressionKind(n);
    default:
      return assertNever(n);
  }
}

describe('Python AST kinds — discriminated-union exhaustiveness', () => {
  it('PyStatement union is exhaustive (assertNever switch type-checks)', () => {
    const stmts: readonly PyStatement[] = [
      {
        kind: 'AnnAssign',
        range: ZERO_RANGE,
        target: 'x',
        annotation: name('int'),
      },
      { kind: 'Assign', range: ZERO_RANGE, targets: ['x'], value: constant(1) },
      {
        kind: 'AsyncFunctionDef',
        range: ZERO_RANGE,
        name: 'f',
        params: [],
        body: [],
        decorators: [],
      },
      { kind: 'AugAssign', range: ZERO_RANGE, target: 'x', op: '+=', value: constant(1) },
      { kind: 'Break', range: ZERO_RANGE },
      {
        kind: 'ClassDef',
        range: ZERO_RANGE,
        name: 'C',
        bases: [],
        body: [],
        members: [],
        decorators: [],
      },
      { kind: 'Continue', range: ZERO_RANGE },
      { kind: 'ExpressionStmt', range: ZERO_RANGE, expression: constant('doc') },
      { kind: 'ForStmt', range: ZERO_RANGE, target: 'i', iter: name('it'), body: [] },
      {
        kind: 'FunctionDef',
        range: ZERO_RANGE,
        name: 'f',
        params: [],
        body: [],
        decorators: [],
      },
      { kind: 'IfStmt', range: ZERO_RANGE, test: name('x'), body: [] },
      { kind: 'ImportFromStmt', range: ZERO_RANGE, module: 'm', level: 0, names: ['x'] },
      { kind: 'ImportStmt', range: ZERO_RANGE, names: ['os'] },
      { kind: 'MatchStmt', range: ZERO_RANGE, subject: name('x'), body: [] },
      { kind: 'Pass', range: ZERO_RANGE },
      { kind: 'RaiseStmt', range: ZERO_RANGE },
      { kind: 'ReturnStmt', range: ZERO_RANGE },
      { kind: 'TryStmt', range: ZERO_RANGE, body: [], handlers: [] },
      { kind: 'UnknownStatement', range: ZERO_RANGE },
      { kind: 'WhileStmt', range: ZERO_RANGE, test: name('x'), body: [] },
      { kind: 'WithStmt', range: ZERO_RANGE, items: [], body: [] },
      { kind: 'YieldStmt', range: ZERO_RANGE, from: false },
    ];
    for (const s of stmts) expect(statementKind(s)).toBe(s.kind);
  });

  it('PyExpression union is exhaustive (assertNever switch type-checks)', () => {
    const exprs: readonly PyExpression[] = [
      { kind: 'Attribute', range: ZERO_RANGE, value: name('o'), attr: 'a' },
      { kind: 'Await', range: ZERO_RANGE, value: name('x') },
      { kind: 'BinOp', range: ZERO_RANGE, op: '+', left: name('a'), right: name('b') },
      { kind: 'BoolOp', range: ZERO_RANGE, op: 'and', values: [name('a'), name('b')] },
      { kind: 'Call', range: ZERO_RANGE, func: name('f'), args: [] },
      { kind: 'Comprehension', range: ZERO_RANGE, compKind: 'list', body: [] },
      {
        kind: 'Conditional',
        range: ZERO_RANGE,
        test: name('c'),
        consequent: name('a'),
        alternate: name('b'),
      },
      { kind: 'Constant', range: ZERO_RANGE, value: 1 },
      { kind: 'Decorator', range: ZERO_RANGE, expression: name('d') },
      { kind: 'Dict', range: ZERO_RANGE, entries: [] },
      { kind: 'FString', range: ZERO_RANGE, quasis: ['a'], parts: [] },
      { kind: 'Lambda', range: ZERO_RANGE, params: [], body: name('x') },
      { kind: 'List', range: ZERO_RANGE, elements: [] },
      { kind: 'Name', range: ZERO_RANGE, id: 'x' },
      { kind: 'Set', range: ZERO_RANGE, elements: [] },
      { kind: 'Starred', range: ZERO_RANGE, value: name('args') },
      { kind: 'Subscript', range: ZERO_RANGE, value: name('xs'), slice: constant(0) },
      { kind: 'Tuple', range: ZERO_RANGE, elements: [] },
      { kind: 'UnaryOp', range: ZERO_RANGE, op: 'not', operand: name('x') },
      { kind: 'UnknownExpression', range: ZERO_RANGE },
      { kind: 'Walrus', range: ZERO_RANGE, target: 'x', value: constant(1) },
      { kind: 'Yield', range: ZERO_RANGE, from: false },
    ];
    for (const e of exprs) expect(expressionKind(e)).toBe(e.kind);
  });

  it('ASTNodePy union (PyProgram + statements + expressions) is exhaustive', () => {
    const program: PyProgram = {
      kind: 'PyProgram',
      body: [],
      filename: 'a.py',
      range: ZERO_RANGE,
    };
    expect(astNodeKind(program)).toBe('PyProgram');
    expect(astNodeKind({ kind: 'UnknownStatement', range: ZERO_RANGE })).toBe('UnknownStatement');
    expect(astNodeKind({ kind: 'UnknownExpression', range: ZERO_RANGE })).toBe('UnknownExpression');
  });

  it('PyProgram has no language field — kind discriminator is sufficient', () => {
    // Type-level: PyProgram is the Python root; the kind discriminator pins
    // it to Python. Unlike TS Program (which carries language: 'ts'|'tsx'|
    // 'js'|'jsx'), PyProgram does not need a sub-language tag.
    const program: PyProgram = {
      kind: 'PyProgram',
      body: [],
      filename: 'a.py',
      range: ZERO_RANGE,
    };
    expect(program.kind).toBe('PyProgram');
    // Verify the absence of a `language` field — TypeScript exactOptionalPropertyTypes
    // enforces this at compile time; runtime check is a documentation aid.
    expect((program as Record<string, unknown>).language).toBeUndefined();
  });

  it('ASTNodePy is the union of every walkable variant', () => {
    // Smoke check: a representative subset of every kind reaches astNodeKind
    // without throwing. The exhaustiveness contract is what matters at type
    // level; this is a runtime confirmation.
    const samples: readonly ASTNodePy[] = [
      { kind: 'PyProgram', body: [], filename: 'a.py', range: ZERO_RANGE },
      { kind: 'Pass', range: ZERO_RANGE },
      { kind: 'Constant', range: ZERO_RANGE, value: 1 },
    ];
    for (const s of samples) {
      expect(() => astNodeKind(s)).not.toThrow();
    }
  });
});

// --------------------------------------------------------------------------
// 6..13. walkPy() semantics.
// --------------------------------------------------------------------------

function makeProgram(): PyProgram {
  // 9-node program:
  //   PyProgram
  //     FunctionDef 'f'  (decorators: [Decorator(Name 'staticmethod')])
  //       (body: [ReturnStmt -> Constant 1])
  //     Assign (value: Call -> [func: Name 'g', arg: Constant 'hi'])
  //     Pass
  return {
    kind: 'PyProgram',
    filename: 'syn.py',
    range: ZERO_RANGE,
    body: [
      {
        kind: 'FunctionDef',
        range: ZERO_RANGE,
        name: 'f',
        params: [],
        decorators: [{ kind: 'Decorator', range: ZERO_RANGE, expression: name('staticmethod') }],
        body: [{ kind: 'ReturnStmt', range: ZERO_RANGE, value: constant(1) }],
      },
      {
        kind: 'Assign',
        range: ZERO_RANGE,
        targets: ['x'],
        value: {
          kind: 'Call',
          range: ZERO_RANGE,
          func: name('g'),
          args: [constant('hi')],
        },
      },
      { kind: 'Pass', range: ZERO_RANGE },
    ],
  };
}

describe('walkPy() — visit semantics', () => {
  it('visits each node exactly once (counter == known node count)', () => {
    const root = makeProgram();
    let count = 0;
    walkPy(root, { onNode: () => void count++ });
    // PyProgram(1) + FunctionDef(1) + Decorator(1) + Name 'staticmethod'(1)
    //   + ReturnStmt(1) + Constant 1(1) + Assign(1) + Call(1) + Name 'g'(1)
    //   + Constant 'hi'(1) + Pass(1) = 11.
    expect(count).toBe(11);
  });

  it('depth-first ordering — onEnter before children, onLeave after', () => {
    const root: PyProgram = {
      kind: 'PyProgram',
      filename: 'a.py',
      range: ZERO_RANGE,
      body: [{ kind: 'ExpressionStmt', range: ZERO_RANGE, expression: name('x') }],
    };
    const log: string[] = [];
    walkPy(root, {
      onEnter: (n) => log.push(`enter:${n.kind}`),
      onLeave: (n) => log.push(`leave:${n.kind}`),
    });
    expect(log).toEqual([
      'enter:PyProgram',
      'enter:ExpressionStmt',
      'enter:Name',
      'leave:Name',
      'leave:ExpressionStmt',
      'leave:PyProgram',
    ]);
  });

  it('onEnter runs before onNode when both are supplied', () => {
    const root: PyProgram = {
      kind: 'PyProgram',
      filename: 'a.py',
      range: ZERO_RANGE,
      body: [{ kind: 'Pass', range: ZERO_RANGE }],
    };
    const log: string[] = [];
    walkPy(root, {
      onEnter: (n) => log.push(`E:${n.kind}`),
      onNode: (n) => log.push(`N:${n.kind}`),
    });
    expect(log).toEqual(['E:PyProgram', 'N:PyProgram', 'E:Pass', 'N:Pass']);
  });

  it('parent parameter — root is null, children carry their parent reference', () => {
    const root = makeProgram();
    const pairs: Array<[string, string | null]> = [];
    walkPy(root, {
      onEnter: (node, parent) => {
        pairs.push([node.kind, parent === null ? null : parent.kind]);
      },
    });
    // Root has null parent.
    expect(pairs[0]).toEqual(['PyProgram', null]);
    // Top-level statements all have PyProgram as parent.
    const fnEntry = pairs.find(([k]) => k === 'FunctionDef');
    expect(fnEntry?.[1]).toBe('PyProgram');
    // Decorator child of FunctionDef.
    const decEntry = pairs.find(([k]) => k === 'Decorator');
    expect(decEntry?.[1]).toBe('FunctionDef');
    // Constant 1 inside ReturnStmt.
    const constEntry = pairs.find(([k, p]) => k === 'Constant' && p === 'ReturnStmt');
    expect(constEntry).toBeDefined();
    // Call child of Assign (assignment value).
    const callEntry = pairs.find(([k]) => k === 'Call');
    expect(callEntry?.[1]).toBe('Assign');
  });

  it('handles every kind without throwing (childrenOfPy covers union)', () => {
    // Build one of each kind and walk it. Any missing case in `childrenOfPy`
    // would surface as either a type error (compile-time) or a runtime throw
    // via assertNever.
    const all: readonly ASTNodePy[] = [
      { kind: 'PyProgram', body: [], filename: 'a.py', range: ZERO_RANGE },
      // Statements
      {
        kind: 'AnnAssign',
        range: ZERO_RANGE,
        target: 'x',
        annotation: name('int'),
      },
      { kind: 'Assign', range: ZERO_RANGE, targets: ['x'], value: constant(1) },
      {
        kind: 'AsyncFunctionDef',
        range: ZERO_RANGE,
        name: 'f',
        params: [],
        body: [],
        decorators: [],
      },
      { kind: 'AugAssign', range: ZERO_RANGE, target: 'x', op: '+=', value: constant(1) },
      { kind: 'Break', range: ZERO_RANGE },
      {
        kind: 'ClassDef',
        range: ZERO_RANGE,
        name: 'C',
        bases: [],
        body: [],
        members: [],
        decorators: [],
      },
      { kind: 'Continue', range: ZERO_RANGE },
      { kind: 'ExpressionStmt', range: ZERO_RANGE, expression: name('x') },
      { kind: 'ForStmt', range: ZERO_RANGE, target: 'i', iter: name('it'), body: [] },
      {
        kind: 'FunctionDef',
        range: ZERO_RANGE,
        name: 'f',
        params: [],
        body: [],
        decorators: [],
      },
      { kind: 'IfStmt', range: ZERO_RANGE, test: name('x'), body: [] },
      { kind: 'ImportFromStmt', range: ZERO_RANGE, module: 'm', level: 0, names: ['x'] },
      { kind: 'ImportStmt', range: ZERO_RANGE, names: ['os'] },
      { kind: 'MatchStmt', range: ZERO_RANGE, subject: name('x'), body: [] },
      { kind: 'Pass', range: ZERO_RANGE },
      { kind: 'RaiseStmt', range: ZERO_RANGE },
      { kind: 'ReturnStmt', range: ZERO_RANGE },
      { kind: 'TryStmt', range: ZERO_RANGE, body: [], handlers: [] },
      { kind: 'UnknownStatement', range: ZERO_RANGE },
      { kind: 'WhileStmt', range: ZERO_RANGE, test: name('x'), body: [] },
      { kind: 'WithStmt', range: ZERO_RANGE, items: [], body: [] },
      { kind: 'YieldStmt', range: ZERO_RANGE, from: false },
      // Expressions
      { kind: 'Attribute', range: ZERO_RANGE, value: name('o'), attr: 'a' },
      { kind: 'Await', range: ZERO_RANGE, value: name('x') },
      { kind: 'BinOp', range: ZERO_RANGE, op: '+', left: name('a'), right: name('b') },
      { kind: 'BoolOp', range: ZERO_RANGE, op: 'and', values: [] },
      { kind: 'Call', range: ZERO_RANGE, func: name('f'), args: [] },
      { kind: 'Comprehension', range: ZERO_RANGE, compKind: 'list', body: [] },
      {
        kind: 'Conditional',
        range: ZERO_RANGE,
        test: name('c'),
        consequent: name('a'),
        alternate: name('b'),
      },
      { kind: 'Constant', range: ZERO_RANGE, value: 1 },
      { kind: 'Decorator', range: ZERO_RANGE, expression: name('d') },
      { kind: 'Dict', range: ZERO_RANGE, entries: [] },
      { kind: 'FString', range: ZERO_RANGE, quasis: ['a'], parts: [] },
      { kind: 'Lambda', range: ZERO_RANGE, params: [], body: name('x') },
      { kind: 'List', range: ZERO_RANGE, elements: [] },
      { kind: 'Name', range: ZERO_RANGE, id: 'x' },
      { kind: 'Set', range: ZERO_RANGE, elements: [] },
      { kind: 'Starred', range: ZERO_RANGE, value: name('args') },
      { kind: 'Subscript', range: ZERO_RANGE, value: name('xs'), slice: constant(0) },
      { kind: 'Tuple', range: ZERO_RANGE, elements: [] },
      { kind: 'UnaryOp', range: ZERO_RANGE, op: 'not', operand: name('x') },
      { kind: 'UnknownExpression', range: ZERO_RANGE },
      { kind: 'Walrus', range: ZERO_RANGE, target: 'x', value: constant(1) },
      { kind: 'Yield', range: ZERO_RANGE, from: false },
    ];
    for (const node of all) {
      expect(() => childrenOfPy(node)).not.toThrow();
      expect(() => walkPy(node, {})).not.toThrow();
    }
  });

  it('determinism — two consecutive walks produce identical kind sequences', () => {
    const root = makeProgram();
    const walkLog = (): readonly string[] => {
      const seq: string[] = [];
      walkPy(root, { onNode: (n) => seq.push(n.kind) });
      return seq;
    };
    const a = walkLog();
    const b = walkLog();
    expect(a.join('|')).toBe(b.join('|'));
  });

  it('childrenOfPy returns empty for leaves', () => {
    const leaves: readonly ASTNodePy[] = [
      { kind: 'Name', range: ZERO_RANGE, id: 'x' },
      { kind: 'Constant', range: ZERO_RANGE, value: 1 },
      { kind: 'Pass', range: ZERO_RANGE },
      { kind: 'Break', range: ZERO_RANGE },
      { kind: 'Continue', range: ZERO_RANGE },
      { kind: 'ImportStmt', range: ZERO_RANGE, names: ['os'] },
      { kind: 'ImportFromStmt', range: ZERO_RANGE, module: 'm', level: 0, names: [] },
      { kind: 'UnknownStatement', range: ZERO_RANGE },
      { kind: 'UnknownExpression', range: ZERO_RANGE },
    ];
    for (const leaf of leaves) {
      expect(childrenOfPy(leaf).length).toBe(0);
    }
  });

  it('childrenOfPy walks Decorator → expression and Call → func then args', () => {
    const dec: ASTNodePy = {
      kind: 'Decorator',
      range: ZERO_RANGE,
      expression: name('staticmethod'),
    };
    const decKids = childrenOfPy(dec);
    expect(decKids.length).toBe(1);
    expect(decKids[0]?.kind).toBe('Name');

    const call: ASTNodePy = {
      kind: 'Call',
      range: ZERO_RANGE,
      func: name('f'),
      args: [name('a'), constant(2)],
    };
    const callKids = childrenOfPy(call);
    expect(callKids.length).toBe(3);
    expect(callKids[0]?.kind).toBe('Name'); // func first
    expect(callKids[1]?.kind).toBe('Name'); // arg 0
    expect(callKids[2]?.kind).toBe('Constant'); // arg 1
  });

  it('Dict walks key, then value, for each entry in source order', () => {
    const dict: ASTNodePy = {
      kind: 'Dict',
      range: ZERO_RANGE,
      entries: [
        { range: ZERO_RANGE, key: constant('k1'), value: constant(1) },
        { range: ZERO_RANGE, value: name('rest') }, // **rest unpacking
        { range: ZERO_RANGE, key: constant('k2'), value: constant(2) },
      ],
    };
    const seq: string[] = [];
    walkPy(dict, {
      onEnter: (n) => {
        if (n.kind === 'Constant') seq.push(`const:${String(n.value)}`);
        if (n.kind === 'Name') seq.push(`name:${n.id}`);
      },
    });
    expect(seq).toEqual(['const:k1', 'const:1', 'name:rest', 'const:k2', 'const:2']);
  });

  it('FString walks parts (interpolations), not quasis (literal segments)', () => {
    const fstr: ASTNodePy = {
      kind: 'FString',
      range: ZERO_RANGE,
      quasis: ['prefix-', '-suffix'],
      parts: [name('x')],
    };
    const seq: string[] = [];
    walkPy(fstr, { onEnter: (n) => seq.push(n.kind) });
    // FString itself + Name 'x' (the interpolation), no quasi nodes.
    expect(seq).toEqual(['FString', 'Name']);
  });
});

// --------------------------------------------------------------------------
// 14. No legacy sentinel anywhere in the new Python source files.
// --------------------------------------------------------------------------

describe('Python AST kinds — no string sentinels', () => {
  it('kinds-py.ts and visit-py.ts contain no legacy sentinel token', async () => {
    const FORBIDDEN = ['INSTANCE', '_EXPORT_', 'SENTINEL'].join('');
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [resolve(here, '..', 'kinds-py.ts'), resolve(here, '..', 'visit-py.ts')];
    for (const path of candidates) {
      const txt = await readFile(path, 'utf8');
      expect(txt).not.toContain(FORBIDDEN);
    }
  });
});

// --------------------------------------------------------------------------
// 15..16. Cross-language Inventory shape (T302).
// --------------------------------------------------------------------------

describe('Inventory.lang — cross-language discriminator (T302)', () => {
  it('TS visitor emits lang: "ts" on every Inventory (synthetic Program)', () => {
    // Synthetic Program — no parser invocation needed; the visitor's contract
    // for the `lang` discriminator is structural, not parser-dependent. This
    // avoids loading the SWC WASM blob from this test file (the parser-side
    // contract is exercised in parser-oxc.test.ts and visitor.test.ts).
    const program: Program = {
      kind: 'Program',
      filename: 'a.ts',
      language: 'ts',
      range: ZERO_RANGE,
      body: [
        {
          kind: 'VariableDecl',
          range: ZERO_RANGE,
          declKind: 'const',
          declarations: [{ name: 'x', range: ZERO_RANGE }],
        },
      ],
    };
    const inv = buildInventory(program);
    expect(inv.lang).toBe('ts');
  });

  it('Inventory.lang is optional (absence interpreted as TS)', () => {
    // Type-level: an Inventory with no `lang` field still type-checks.
    const inv: Inventory = {
      declarations: [],
      imports: [],
      usages: [],
    };
    expect(inv.lang).toBeUndefined();
    // And an explicit 'py' value also type-checks (forward-compat for T305).
    const pyInv: Inventory = {
      lang: 'py',
      declarations: [],
      imports: [],
      usages: [],
    };
    expect(pyInv.lang).toBe('py');
  });
});
