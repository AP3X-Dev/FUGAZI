/**
 * all-list.test.ts — Phase 4a T306 acceptance for `__all__` extraction.
 *
 * Six fixture cases plus the underscore-heuristic fallback:
 *   1. List literal — `__all__ = ['foo', 'bar']`.
 *   2. Tuple literal — `__all__ = ('foo', 'bar')`.
 *   3. Mixed quotes — `__all__ = ['foo', "bar"]`.
 *   4. Empty list — `__all__ = []` (means "nothing exported").
 *   5. Absent — falls back to underscore heuristic.
 *   6. Non-literal (concatenation) — falls back; no warn fires.
 *
 * Plus invariants:
 *   - The `__all__` assignment itself is NOT surfaced as a Declaration.
 *   - Underscore-leading names listed in `__all__` are exported anyway.
 *   - Re-binding `__all__` later in the module wins last.
 */

import { describe, expect, it } from 'vitest';
import { parsePythonAst } from '../../parsers-py/adapter.js';
import { buildPyInventory } from '../index.js';

async function build(src: string): Promise<ReturnType<typeof buildPyInventory>> {
  const r = await parsePythonAst(src, 'fixture.py');
  return buildPyInventory(r.program, src, 'fixture.py');
}

function exportedMap(inv: ReturnType<typeof buildPyInventory>): ReadonlyMap<string, boolean> {
  return new Map(inv.declarations.map((d) => [d.name, d.exported]));
}

describe('__all__ extraction (T306)', () => {
  it('1. list literal — only listed names are exported', async () => {
    const src = '__all__ = ["foo"]\ndef foo(): pass\ndef bar(): pass\n';
    const inv = await build(src);
    const exp = exportedMap(inv);
    expect(exp.get('foo')).toBe(true);
    expect(exp.get('bar')).toBe(false);
  });

  it('2. tuple literal — same semantics as list', async () => {
    const src = '__all__ = ("foo", "bar")\ndef foo(): pass\ndef bar(): pass\ndef baz(): pass\n';
    const inv = await build(src);
    const exp = exportedMap(inv);
    expect(exp.get('foo')).toBe(true);
    expect(exp.get('bar')).toBe(true);
    expect(exp.get('baz')).toBe(false);
  });

  it('3. mixed single + double quotes resolves the same', async () => {
    const src = `__all__ = ['foo', "bar"]\ndef foo(): pass\ndef bar(): pass\n`;
    const inv = await build(src);
    const exp = exportedMap(inv);
    expect(exp.get('foo')).toBe(true);
    expect(exp.get('bar')).toBe(true);
  });

  it('4. empty list — nothing exported', async () => {
    const src = '__all__ = []\ndef foo(): pass\ndef bar(): pass\nclass Baz: pass\n';
    const inv = await build(src);
    const exp = exportedMap(inv);
    expect(exp.get('foo')).toBe(false);
    expect(exp.get('bar')).toBe(false);
    expect(exp.get('Baz')).toBe(false);
  });

  it('5. absent __all__ — underscore heuristic applies', async () => {
    const src = 'def foo(): pass\ndef _hidden(): pass\nclass Bar: pass\n';
    const inv = await build(src);
    const exp = exportedMap(inv);
    expect(exp.get('foo')).toBe(true);
    expect(exp.get('_hidden')).toBe(false);
    expect(exp.get('Bar')).toBe(true);
  });

  it('6. non-literal __all__ — falls back to underscore heuristic', async () => {
    // Concatenation makes the value non-literal at parse time.
    const src =
      '__all__ = ["foo"] + ["bar"]\ndef foo(): pass\ndef bar(): pass\ndef _priv(): pass\n';
    const inv = await build(src);
    const exp = exportedMap(inv);
    // Both names not starting with `_` should be exported under the fallback.
    expect(exp.get('foo')).toBe(true);
    expect(exp.get('bar')).toBe(true);
    expect(exp.get('_priv')).toBe(false);
  });

  it('does NOT surface __all__ itself as a Declaration', async () => {
    const src = '__all__ = ["foo"]\ndef foo(): pass\n';
    const inv = await build(src);
    expect(inv.declarations.map((d) => d.name)).not.toContain('__all__');
  });

  it('underscore-leading name listed in __all__ is exported', async () => {
    const src = '__all__ = ["_lib"]\ndef _lib(): pass\ndef other(): pass\n';
    const inv = await build(src);
    const exp = exportedMap(inv);
    expect(exp.get('_lib')).toBe(true);
    expect(exp.get('other')).toBe(false);
  });

  it('last assignment wins when __all__ is rebound', async () => {
    const src = '__all__ = ["foo"]\n__all__ = ["bar"]\ndef foo(): pass\ndef bar(): pass\n';
    const inv = await build(src);
    const exp = exportedMap(inv);
    expect(exp.get('foo')).toBe(false);
    expect(exp.get('bar')).toBe(true);
  });
});
