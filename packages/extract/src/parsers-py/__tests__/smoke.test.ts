/**
 * smoke.test.ts — Phase 4a T301-test smoke fixtures.
 *
 * Exercises 10 representative Python constructs through `parsePython`,
 * asserting:
 *   1. Parse completes without an exception.
 *   2. The tree's root is `module` (the tree-sitter-python top-level node).
 *   3. A specific named-node descendant lives at expected byte offsets.
 *   4. `result.errors` is empty for each fixture.
 *
 * Plus:
 *   - one in-memory tamper test (bytes flipped before integrity gate),
 *   - one 10-iteration determinism test (byte offsets identical across runs),
 *   - three misc tests (BOM tolerance, parse-error tolerance, blank source).
 */

import { describe, expect, it } from 'vitest';
import type Parser from 'web-tree-sitter';
import { __loadPythonParserFromBytesForTest } from '../../wasm/python/load.js';
import { parsePython } from '../tree-sitter.js';

interface OffsetsAsserter {
  readonly nodeType: string;
  readonly startByte: number;
  readonly endByte: number;
}

/**
 * Find the FIRST descendant of `root` whose `type === target`. Walks via
 * tree-cursor depth-first, left-to-right — same order tree-sitter exposes
 * the parse tree.
 */
function firstNodeOfType(root: Parser.SyntaxNode, target: string): Parser.SyntaxNode | null {
  if (root.type === target) {
    return root;
  }
  const cursor = root.walk();
  let found: Parser.SyntaxNode | null = null;
  const visit = (): boolean => {
    const node = cursor.currentNode;
    if (node.type === target) {
      found = node;
      return true;
    }
    if (cursor.gotoFirstChild()) {
      do {
        if (visit()) {
          return true;
        }
      } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }
    return false;
  };
  visit();
  cursor.delete();
  return found;
}

async function expectFixture(source: string, expected: OffsetsAsserter): Promise<void> {
  const result = await parsePython(source, 'fixture.py');
  expect(result.rootNode.type).toBe('module');
  expect(result.errors).toEqual([]);
  const node = firstNodeOfType(result.rootNode, expected.nodeType);
  expect(node, `expected to find a '${expected.nodeType}' node`).not.toBeNull();
  if (node === null) return;
  expect(node.startIndex).toBe(expected.startByte);
  expect(node.endIndex).toBe(expected.endByte);
}

describe('parsePython smoke fixtures (T301)', () => {
  it('parses a simple def with f-string return', async () => {
    const src = "def hello(name): return f'Hi {name}'";
    // 'def' starts at byte 0; the function_definition spans the whole input.
    await expectFixture(src, {
      nodeType: 'function_definition',
      startByte: 0,
      endByte: src.length,
    });
  });

  it('parses async def with await', async () => {
    const src = 'async def fetch(url): return await session.get(url)';
    await expectFixture(src, {
      nodeType: 'function_definition',
      startByte: 0,
      endByte: src.length,
    });
  });

  it('parses a class with method', async () => {
    const src = 'class Foo:\n    def bar(self): pass';
    await expectFixture(src, {
      nodeType: 'class_definition',
      startByte: 0,
      endByte: src.length,
    });
    const result = await parsePython(src, 'fixture.py');
    const method = firstNodeOfType(result.rootNode, 'function_definition');
    expect(method).not.toBeNull();
    expect(method?.startIndex).toBe(15); // '    def bar(self): pass' starts at byte 15
  });

  it('parses a decorator on a class', async () => {
    const src = '@dataclass\nclass Point:\n    x: int\n    y: int';
    const result = await parsePython(src, 'fixture.py');
    expect(result.errors).toEqual([]);
    const dec = firstNodeOfType(result.rootNode, 'decorator');
    expect(dec).not.toBeNull();
    expect(dec?.startIndex).toBe(0);
    // `@dataclass` is 10 bytes; tree-sitter-python's decorator node typically
    // ends at the newline (exclusive), so endIndex is 10.
    expect(dec?.endIndex).toBe(10);
    const klass = firstNodeOfType(result.rootNode, 'class_definition');
    expect(klass).not.toBeNull();
  });

  it('parses a walrus operator in an if condition', async () => {
    const src = 'if (n := len(items)) > 10:\n    pass';
    const result = await parsePython(src, 'fixture.py');
    expect(result.errors).toEqual([]);
    const walrus = firstNodeOfType(result.rootNode, 'named_expression');
    expect(walrus).not.toBeNull();
    // 'n := len(items)' starts after 'if (' i.e. at byte 4
    expect(walrus?.startIndex).toBe(4);
    expect(walrus?.endIndex).toBe(19); // 'n := len(items)' length 15 -> 4..19
  });

  it('parses a match/case statement', async () => {
    const src = "match cmd:\n    case 'go':\n        pass\n    case _:\n        pass";
    const result = await parsePython(src, 'fixture.py');
    expect(result.errors).toEqual([]);
    const match = firstNodeOfType(result.rootNode, 'match_statement');
    expect(match).not.toBeNull();
    expect(match?.startIndex).toBe(0);
  });

  it('parses a list comprehension', async () => {
    const src = '[x*2 for x in range(10) if x > 5]';
    const result = await parsePython(src, 'fixture.py');
    expect(result.errors).toEqual([]);
    const comp = firstNodeOfType(result.rootNode, 'list_comprehension');
    expect(comp).not.toBeNull();
    expect(comp?.startIndex).toBe(0);
    expect(comp?.endIndex).toBe(src.length);
  });

  it('parses a generator with yield from', async () => {
    const src = 'def gen():\n    yield from range(10)';
    const result = await parsePython(src, 'fixture.py');
    expect(result.errors).toEqual([]);
    const yieldNode = firstNodeOfType(result.rootNode, 'yield');
    expect(yieldNode).not.toBeNull();
    expect(yieldNode?.startIndex).toBe(15); // '    yield from range(10)' yield at byte 15
  });

  it('parses try/except/finally', async () => {
    const src = 'try:\n    x = 1\nexcept ValueError as e:\n    pass\nfinally:\n    cleanup()';
    const result = await parsePython(src, 'fixture.py');
    expect(result.errors).toEqual([]);
    const tryStmt = firstNodeOfType(result.rootNode, 'try_statement');
    expect(tryStmt).not.toBeNull();
    expect(tryStmt?.startIndex).toBe(0);
    const exceptClause = firstNodeOfType(result.rootNode, 'except_clause');
    expect(exceptClause).not.toBeNull();
    // 'except ValueError as e:' starts at byte 15 (after 'try:\n    x = 1\n').
    expect(exceptClause?.startIndex).toBe(15);
  });

  it('parses a with statement', async () => {
    const src = "with open('f') as f:\n    data = f.read()";
    const result = await parsePython(src, 'fixture.py');
    expect(result.errors).toEqual([]);
    const withStmt = firstNodeOfType(result.rootNode, 'with_statement');
    expect(withStmt).not.toBeNull();
    expect(withStmt?.startIndex).toBe(0);
    expect(withStmt?.endIndex).toBe(src.length);
  });
});

describe('parsePython integrity (T301)', () => {
  it('rejects a tampered WASM blob with a non-WASM-magic prefix', async () => {
    // Byte sequence that is NOT a valid WebAssembly module — leading bytes
    // are 0xFF rather than the WASM magic 0x00 0x61 0x73 0x6d. Any tree-sitter
    // language load must reject this BEFORE producing a Parser.Language.
    const tampered = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x01, 0x00, 0x00, 0x00]);

    let caught: unknown;
    try {
      await __loadPythonParserFromBytesForTest(tampered);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    // We don't pin the verbatim message of the underlying WebAssembly /
    // emscripten failure (it varies across runtimes), only that the load
    // surfaces an error rather than handing back a Parser bound to junk.
  });
});

describe('parsePython determinism (T301)', () => {
  it('produces identical byte offsets across 10 parses of the same input', async () => {
    const src =
      'def deterministic(a, b):\n' +
      '    if a > b:\n' +
      "        return 'big'\n" +
      "    return 'small'\n";

    const offsets: number[][] = [];
    for (let i = 0; i < 10; i++) {
      const result = await parsePython(src, 'det.py');
      const fn = firstNodeOfType(result.rootNode, 'function_definition');
      expect(fn).not.toBeNull();
      const cond = firstNodeOfType(result.rootNode, 'if_statement');
      expect(cond).not.toBeNull();
      const ret = firstNodeOfType(result.rootNode, 'return_statement');
      expect(ret).not.toBeNull();
      offsets.push([
        fn?.startIndex ?? -1,
        fn?.endIndex ?? -1,
        cond?.startIndex ?? -1,
        cond?.endIndex ?? -1,
        ret?.startIndex ?? -1,
        ret?.endIndex ?? -1,
      ]);
    }
    // Every iteration must produce the SAME tuple of offsets.
    const first = offsets[0];
    expect(first).toBeDefined();
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toEqual(first);
    }
  });
});

describe('parsePython misc (T301)', () => {
  it('strips a leading UTF-8 BOM defensively', async () => {
    const src = '﻿def bom_test():\n    pass';
    const result = await parsePython(src, 'bom.py');
    expect(result.errors).toEqual([]);
    const fn = firstNodeOfType(result.rootNode, 'function_definition');
    expect(fn).not.toBeNull();
    // After BOM strip, the def starts at byte 0.
    expect(fn?.startIndex).toBe(0);
  });

  it('returns a partial tree + error list on malformed input (fail-soft)', async () => {
    // Missing ':' after function header — tree-sitter recovers but emits
    // ERROR / MISSING markers somewhere in the tree.
    const src = 'def bad(\n    pass';
    const result = await parsePython(src, 'bad.py');
    expect(result.rootNode.type).toBe('module');
    expect(result.errors.length).toBeGreaterThan(0);
    // Every collected error has plausible offsets bounded by source length.
    for (const e of result.errors) {
      expect(e.byteOffset).toBeGreaterThanOrEqual(0);
      expect(e.endByteOffset).toBeLessThanOrEqual(src.length);
      expect(['error', 'missing']).toContain(e.kind);
    }
  });

  it('parses an empty source without error', async () => {
    const result = await parsePython('', 'empty.py');
    expect(result.rootNode.type).toBe('module');
    expect(result.errors).toEqual([]);
    expect(result.rootNode.startIndex).toBe(0);
    expect(result.rootNode.endIndex).toBe(0);
  });
});
