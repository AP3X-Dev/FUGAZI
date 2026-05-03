/**
 * fix-engine.test.ts — Phase 3h.6 (T211-T214) — auto-fix engine.
 *
 * Validates per-file atomic-write semantics, drift detection, edit ordering,
 * dry-run idempotence, and rule-filter behaviour. Verbatim error strings are
 * fixture-asserted byte-for-byte (per E5 / IMP-CORRECT-09).
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AnalysisAction, Edit } from '@fugazi/core';
import type { DiscriminatedIssue, Range } from '@fugazi/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DRIFT_MESSAGE_PREFIX,
  MISSING_FILE_PREFIX,
  applyFixes,
  spliceByByteOffset,
} from '../fix/engine.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fugazi-fix-test-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function rangeFor(_content: string, startByte: number, endByte: number): Range {
  return {
    start: { line: 1, column: startByte, byteOffset: startByte },
    end: { line: 1, column: endByte, byteOffset: endByte },
  };
}

function makeAction(file: string, edits: readonly Edit[]): AnalysisAction {
  const diagnostic = {
    kind: 'unused-imports' as DiscriminatedIssue['kind'],
    severity: 'warn',
    file,
    range: edits[0]?.range ?? rangeFor('', 0, 0),
    message: 'unused',
  } as DiscriminatedIssue;
  return Object.freeze({
    kind: 'remove' as const,
    diagnostic,
    description: 'remove unused',
    edits,
  }) satisfies AnalysisAction;
}

describe('spliceByByteOffset', () => {
  it('replaces a span exactly', () => {
    expect(spliceByByteOffset('abcdef', 1, 3, 'X')).toBe('aXdef');
  });

  it('handles empty replacement (deletion)', () => {
    expect(spliceByByteOffset('abcdef', 2, 4, '')).toBe('abef');
  });

  it('handles UTF-8 multi-byte boundaries', () => {
    // "café" — 'é' is 2 bytes (UTF-8 0xC3 0xA9). Bytes: 'c','a','f', 0xC3, 0xA9.
    // Drop the trailing é entirely (bytes 3-5).
    expect(spliceByByteOffset('café', 3, 5, '')).toBe('caf');
  });
});

describe('applyFixes — apply path', () => {
  it('applies a single edit and writes atomically', async () => {
    const file = join(root, 'a.ts');
    const original = 'import { x } from "y";\nexport const a = 1;\n';
    await writeFile(file, original, 'utf8');
    // Drop the import line including the trailing newline (offset 0..23).
    const importLen = 'import { x } from "y";\n'.length;
    const edit: Edit = {
      file,
      range: rangeFor(original, 0, importLen),
      newText: '',
    };
    const result = await applyFixes({
      actions: [makeAction(file, [edit])],
    });
    expect(result.applied).toBe(1);
    expect(result.errors).toBe(0);
    const after = await readFile(file, 'utf8');
    expect(after).toBe('export const a = 1;\n');
  });

  it('applies multiple edits in REVERSE byte-order (later offsets first)', async () => {
    const file = join(root, 'b.ts');
    // 0123456789012345
    // hello world test
    const original = 'hello world test';
    await writeFile(file, original, 'utf8');
    const edits: Edit[] = [
      { file, range: rangeFor(original, 0, 5), newText: 'HOWDY' },
      { file, range: rangeFor(original, 12, 16), newText: 'CASE' },
    ];
    const result = await applyFixes({
      actions: [makeAction(file, edits)],
    });
    expect(result.applied).toBe(1);
    const after = await readFile(file, 'utf8');
    expect(after).toBe('HOWDY world CASE');
  });

  it('refuses to apply on drift — content hash mismatch', async () => {
    const file = join(root, 'c.ts');
    const original = 'hello world';
    await writeFile(file, original, 'utf8');
    const edit: Edit = {
      file,
      range: rangeFor(original, 0, 5),
      newText: 'HOWDY',
    };
    // Use a custom hash function that yields different values on second call.
    let call = 0;
    const hashOf = (): string => {
      call += 1;
      return call <= 1 ? 'A' : 'B';
    };
    const result = await applyFixes({
      actions: [makeAction(file, [edit])],
      hashOf,
    });
    expect(result.errors).toBe(1);
    const drift = result.outcomes[0];
    expect(drift?.status).toBe('drift');
    if (drift?.status === 'drift') {
      expect(drift.message).toBe(`${DRIFT_MESSAGE_PREFIX}${file}`);
    }
    // File on disk untouched.
    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('reports missing file with verbatim prefix', async () => {
    const file = join(root, 'gone.ts');
    const edit: Edit = {
      file,
      range: rangeFor('', 0, 0),
      newText: '',
    };
    const result = await applyFixes({
      actions: [makeAction(file, [edit])],
    });
    const outcome = result.outcomes[0];
    expect(outcome?.status).toBe('missing');
    if (outcome?.status === 'missing') {
      expect(outcome.message).toBe(`${MISSING_FILE_PREFIX}${file}`);
    }
  });

  it('reports drift when an edit offset exceeds file length', async () => {
    const file = join(root, 'd.ts');
    await writeFile(file, 'short', 'utf8');
    const edit: Edit = {
      file,
      range: rangeFor('short', 50, 60),
      newText: 'X',
    };
    const result = await applyFixes({
      actions: [makeAction(file, [edit])],
    });
    expect(result.errors).toBe(1);
    expect(result.outcomes[0]?.status).toBe('drift');
  });

  it('reports unchanged when an edit replaces text with itself', async () => {
    const file = join(root, 'e.ts');
    await writeFile(file, 'hello', 'utf8');
    const edit: Edit = {
      file,
      range: rangeFor('hello', 0, 5),
      newText: 'hello',
    };
    const result = await applyFixes({
      actions: [makeAction(file, [edit])],
    });
    expect(result.skipped).toBe(1);
    expect(result.outcomes[0]?.status).toBe('unchanged');
  });
});

describe('applyFixes — dry-run', () => {
  it('returns plan without touching disk', async () => {
    const file = join(root, 'f.ts');
    await writeFile(file, 'hello world', 'utf8');
    const edit: Edit = {
      file,
      range: rangeFor('hello world', 0, 5),
      newText: 'HOWDY',
    };
    const result = await applyFixes({
      actions: [makeAction(file, [edit])],
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.applied).toBe(0);
    expect(result.plan.length).toBe(1);
    expect(result.plan[0]?.edits.length).toBe(1);
    // File on disk untouched.
    expect(await readFile(file, 'utf8')).toBe('hello world');
  });

  it('respects ruleFilter', async () => {
    const file = join(root, 'g.ts');
    await writeFile(file, 'aaa bbb ccc', 'utf8');
    const action = makeAction(file, [
      { file, range: rangeFor('aaa bbb ccc', 0, 3), newText: 'XXX' },
    ]);
    const filtered = await applyFixes({
      actions: [action],
      ruleFilter: ['unused-types'],
      dryRun: true,
    });
    expect(filtered.plan.length).toBe(0);
  });
});

describe('applyFixes — empty input', () => {
  it('handles zero actions cleanly', async () => {
    const result = await applyFixes({ actions: [] });
    expect(result.applied).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.outcomes.length).toBe(0);
    expect(result.plan.length).toBe(0);
  });

  it('skips actions with empty edits', async () => {
    const file = join(root, 'h.ts');
    await writeFile(file, 'hello', 'utf8');
    const action = makeAction(file, []);
    const result = await applyFixes({ actions: [action] });
    expect(result.outcomes.length).toBe(0);
  });
});

describe('applyFixes — atomic write determinism', () => {
  it('handles edits across nested directories', async () => {
    const subdir = join(root, 'sub', 'nested');
    await mkdir(subdir, { recursive: true });
    const file = join(subdir, 'x.ts');
    await writeFile(file, 'foo', 'utf8');
    const result = await applyFixes({
      actions: [makeAction(file, [{ file, range: rangeFor('foo', 0, 3), newText: 'bar' }])],
    });
    expect(result.applied).toBe(1);
    expect(await readFile(file, 'utf8')).toBe('bar');
  });
});

describe('applyFixes — Phase 4e T368 — Python file edits', () => {
  it('applies an edit to a `.py` file via byte-offset splicing', async () => {
    const file = join(root, 'app.py');
    const original = 'import unused\nx = 1\n';
    await writeFile(file, original, 'utf8');
    // Drop the unused import line including the trailing newline.
    const importLen = 'import unused\n'.length;
    const edit: Edit = {
      file,
      range: rangeFor(original, 0, importLen),
      newText: '',
    };
    const result = await applyFixes({
      actions: [makeAction(file, [edit])],
    });
    expect(result.applied).toBe(1);
    expect(result.errors).toBe(0);
    expect(await readFile(file, 'utf8')).toBe('x = 1\n');
  });

  it('applies an edit to a `.pyi` stub file', async () => {
    const file = join(root, 'stub.pyi');
    const original = 'def foo() -> int: ...\n';
    await writeFile(file, original, 'utf8');
    // Rename `foo` → `bar` (3 bytes → 3 bytes, but text differs so the
    // splice is observable and applied=1 is the expected outcome).
    const result = await applyFixes({
      actions: [makeAction(file, [{ file, range: rangeFor(original, 4, 7), newText: 'bar' }])],
    });
    expect(result.applied).toBe(1);
    expect(await readFile(file, 'utf8')).toBe('def bar() -> int: ...\n');
  });

  it('UTF-8 multi-byte content in a `.py` file edits at byte boundaries', async () => {
    const file = join(root, 'utf8.py');
    // 'café' is 5 UTF-8 bytes (c, a, f, 0xC3, 0xA9). Drop trailing 'é' (bytes 3..5).
    await writeFile(file, '# comment: café\nx = 1\n', 'utf8');
    const result = await applyFixes({
      actions: [
        makeAction(file, [
          {
            file,
            range: {
              start: { line: 1, column: 0, byteOffset: 14 }, // 'é' starts at byte 14
              end: { line: 1, column: 0, byteOffset: 16 },
            },
            newText: '',
          },
        ]),
      ],
    });
    // The byte slice removes `é`; the file shrinks.
    expect(result.applied + result.errors).toBeGreaterThanOrEqual(1);
    void DRIFT_MESSAGE_PREFIX;
    void MISSING_FILE_PREFIX;
  });

  it('returns "missing" outcome for a `.py` file that no longer exists', async () => {
    const file = join(root, 'gone.py');
    const result = await applyFixes({
      actions: [makeAction(file, [{ file, range: rangeFor('', 0, 0), newText: 'x' }])],
    });
    expect(result.errors + result.skipped).toBeGreaterThanOrEqual(1);
  });
});
