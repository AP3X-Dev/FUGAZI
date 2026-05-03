/**
 * type-checking.test.ts — Phase 4a T307 acceptance for the
 * `if TYPE_CHECKING:` block detector.
 *
 * Four fixture cases:
 *   1. Direct `TYPE_CHECKING` (after `from typing import TYPE_CHECKING`).
 *   2. Qualified `typing.TYPE_CHECKING` (after `import typing`).
 *   3. Nested IfStmt with outer `TYPE_CHECKING` — still type-only.
 *   4. Imports OUTSIDE a TYPE_CHECKING block remain `static`.
 *
 * Plus the v1-known-limitation negative case: an aliased
 * `from typing import TYPE_CHECKING as TC` resolves correctly.
 */

import { describe, expect, it } from 'vitest';
import { parsePythonAst } from '../../parsers-py/adapter.js';
import { buildPyInventory } from '../index.js';

async function build(src: string): Promise<ReturnType<typeof buildPyInventory>> {
  const r = await parsePythonAst(src, 'fixture.py');
  return buildPyInventory(r.program, src, 'fixture.py');
}

describe('TYPE_CHECKING block awareness (T307)', () => {
  it('1. direct TYPE_CHECKING — imports inside emit kind: type', async () => {
    const src = [
      'from typing import TYPE_CHECKING',
      'if TYPE_CHECKING:',
      '    import os',
      '    from sys import argv',
      '',
    ].join('\n');
    const inv = await build(src);
    // The `from typing import TYPE_CHECKING` import itself appears as static
    // — it's the runtime import that brings the flag into scope.
    const typing = inv.imports.find((i) => i.source === 'typing');
    expect(typing?.kind).toBe('static');
    // The two imports inside the block must be 'type'.
    const os = inv.imports.find((i) => i.source === 'os');
    const sys = inv.imports.find((i) => i.source === 'sys');
    expect(os?.kind).toBe('type');
    expect(sys?.kind).toBe('type');
  });

  it('2. qualified typing.TYPE_CHECKING — imports inside emit kind: type', async () => {
    const src = ['import typing', 'if typing.TYPE_CHECKING:', '    import os', ''].join('\n');
    const inv = await build(src);
    const os = inv.imports.find((i) => i.source === 'os');
    expect(os?.kind).toBe('type');
  });

  it('3. nested IfStmt where outer is TYPE_CHECKING — still type-only', async () => {
    const src = [
      'from typing import TYPE_CHECKING',
      'if TYPE_CHECKING:',
      '    if True:',
      '        import os',
      '',
    ].join('\n');
    const inv = await build(src);
    const os = inv.imports.find((i) => i.source === 'os');
    expect(os?.kind).toBe('type');
  });

  it('4. imports OUTSIDE TYPE_CHECKING block remain static', async () => {
    const src = [
      'from typing import TYPE_CHECKING',
      'import json',
      'if TYPE_CHECKING:',
      '    import os',
      'import sys',
      '',
    ].join('\n');
    const inv = await build(src);
    const json = inv.imports.find((i) => i.source === 'json');
    const sys = inv.imports.find((i) => i.source === 'sys');
    const os = inv.imports.find((i) => i.source === 'os');
    expect(json?.kind).toBe('static');
    expect(sys?.kind).toBe('static');
    expect(os?.kind).toBe('type');
  });

  it('aliased TYPE_CHECKING — `from typing import TYPE_CHECKING as TC`', async () => {
    const src = ['from typing import TYPE_CHECKING as TC', 'if TC:', '    import os', ''].join(
      '\n',
    );
    const inv = await build(src);
    const os = inv.imports.find((i) => i.source === 'os');
    expect(os?.kind).toBe('type');
  });

  it('aliased import typing — `import typing as t` then `if t.TYPE_CHECKING:`', async () => {
    const src = ['import typing as t', 'if t.TYPE_CHECKING:', '    import os', ''].join('\n');
    const inv = await build(src);
    const os = inv.imports.find((i) => i.source === 'os');
    expect(os?.kind).toBe('type');
  });

  it('an `if some_other_var:` block does NOT mark imports as type-only', async () => {
    const src = ['flag = True', 'if flag:', '    import os', ''].join('\n');
    const inv = await build(src);
    const os = inv.imports.find((i) => i.source === 'os');
    expect(os?.kind).toBe('static');
  });
});
