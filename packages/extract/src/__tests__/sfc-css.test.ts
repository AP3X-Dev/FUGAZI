/**
 * sfc-css.test.ts — Phase 3c.5 Dispatch D acceptance suite for the plain CSS
 * + CSS-modules handler (T074-test).
 *
 * Each fixture is an inline `.css` source string. The 6 fixtures cover:
 *   1. Plain `.foo { color: red; }` — single class declaration
 *   2. Multiple classes in one rule: `.a, .b, .c { ... }`
 *   3. CSS-modules `composes: bar from './other.module.css'` inside a rule
 *   4. `@import './reset.css';` at top of file
 *   5. Custom properties: `:root { --primary: red; }` — no class emitted
 *   6. Nested at-rule: `@media (min-width: 600px) { .responsive { ... } }`
 *
 * Plus 3 structural invariants:
 *   - Determinism: byte-equal `JSON.stringify(inventory)` across repeated parses
 *   - Empty `.css` produces empty Inventory
 *   - Class declarations sorted by `range.start.byteOffset`
 *
 * Total: 3 structural + 6 fixture (+ 4 sub-fixtures) = 13 cases.
 */

import { describe, expect, it } from 'vitest';
import { parseCss } from '../sfc/css.js';
import type { Inventory } from '../visitor/types.js';

function declNames(inv: Inventory): string[] {
  return inv.declarations.map((d) => d.name);
}

function importSources(inv: Inventory): string[] {
  return inv.imports.map((i) => i.source);
}

function classUsages(inv: Inventory): string[] {
  return inv.usages.filter((u) => u.kind === 'css-class').map((u) => u.name);
}

// ---------------------------------------------------------------------------
// Structural invariants
// ---------------------------------------------------------------------------

describe('css — structural invariants', () => {
  it('determinism: byte-equal JSON across repeated parses', () => {
    const src = `
@import './reset.css';
.btn { color: red; }
.btn-primary {
  composes: btn from './btn.module.css';
  background: blue;
}
`;
    const a = parseCss(src, 'fixture.css');
    const b = parseCss(src, 'fixture.css');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('empty CSS produces empty Inventory', () => {
    const inv = parseCss('', 'empty.css');
    expect(inv.declarations.length).toBe(0);
    expect(inv.imports.length).toBe(0);
    expect(inv.usages.length).toBe(0);
  });

  it('class declarations sorted by range.start.byteOffset', () => {
    const src = `.zeta { color: red; }
.alpha { color: blue; }
.middle { color: green; }`;
    const inv = parseCss(src, 'sort.css');
    const offsets = inv.declarations.map((d) => d.range.start.byteOffset);
    const sorted = offsets.slice().sort((a, b) => a - b);
    expect(offsets).toEqual(sorted);
    // And they should be in source order (zeta, alpha, middle), not alpha-sorted.
    expect(declNames(inv)).toEqual(['zeta', 'alpha', 'middle']);
  });
});

// ---------------------------------------------------------------------------
// 6 CSS fixtures (+ a few sub-fixtures)
// ---------------------------------------------------------------------------

describe('css — fixtures', () => {
  it('1. plain .foo rule emits one class declaration', () => {
    const src = '.foo { color: red; }';
    const inv = parseCss(src, 'a.css');
    expect(declNames(inv)).toEqual(['foo']);
    const decl = inv.declarations[0];
    if (decl === undefined) throw new Error('expected declaration');
    expect(decl.kind).toBe('css-class');
    expect(decl.exported).toBe(true);
    expect(decl.members).toEqual([]);
    expect(inv.imports.length).toBe(0);
    expect(inv.usages.length).toBe(0);
  });

  it('2. multiple classes in one rule emit three declarations', () => {
    const src = '.a, .b, .c { color: red; }';
    const inv = parseCss(src, 'b.css');
    expect(declNames(inv)).toEqual(['a', 'b', 'c']);
    expect(inv.declarations.every((d) => d.kind === 'css-class')).toBe(true);
  });

  it('3. composes: bar from "./other.module.css" emits import + usage + decl', () => {
    const src = `.foo {
  composes: bar from './other.module.css';
  color: red;
}`;
    const inv = parseCss(src, 'c.module.css');
    expect(declNames(inv)).toEqual(['foo']);
    expect(importSources(inv)).toContain('./other.module.css');
    expect(classUsages(inv)).toContain('bar');
  });

  it('3b. composes: foo, bar from "./x.module.css" emits two usages', () => {
    const src = `.target {
  composes: foo, bar from './x.module.css';
}`;
    const inv = parseCss(src, 'c2.module.css');
    expect(declNames(inv)).toEqual(['target']);
    expect(importSources(inv)).toContain('./x.module.css');
    const uses = classUsages(inv);
    expect(uses).toContain('foo');
    expect(uses).toContain('bar');
  });

  it('3c. composes: localOnly (no from) emits a usage but no import', () => {
    const src = `.parent { color: red; }
.child {
  composes: parent;
  font-weight: bold;
}`;
    const inv = parseCss(src, 'c3.module.css');
    expect(declNames(inv)).toEqual(['parent', 'child']);
    expect(inv.imports.length).toBe(0);
    expect(classUsages(inv)).toContain('parent');
  });

  it('4. @import "./reset.css"; emits a static import', () => {
    const src = `@import './reset.css';
.btn { color: red; }`;
    const inv = parseCss(src, 'd.css');
    expect(importSources(inv)).toEqual(['./reset.css']);
    const imp = inv.imports[0];
    if (imp === undefined) throw new Error('expected import');
    expect(imp.kind).toBe('static');
    expect(imp.resolvable).toBe(true);
    expect(declNames(inv)).toEqual(['btn']);
  });

  it('4b. @import url("./reset.css"); also emits a static import', () => {
    const src = `@import url('./reset.css');
.btn { color: red; }`;
    const inv = parseCss(src, 'd2.css');
    expect(importSources(inv)).toEqual(['./reset.css']);
  });

  it('5. :root custom properties do not produce class declarations', () => {
    const src = `:root {
  --primary: red;
  --secondary: blue;
}`;
    const inv = parseCss(src, 'e.css');
    expect(inv.declarations.length).toBe(0);
    expect(inv.imports.length).toBe(0);
  });

  it('6. nested @media at-rule emits class inside body', () => {
    const src = `@media (min-width: 600px) {
  .responsive { color: red; }
}`;
    const inv = parseCss(src, 'f.css');
    expect(declNames(inv)).toEqual(['responsive']);
  });

  it('6b. content: ".foo" inside a string literal does NOT emit a declaration', () => {
    const src = '.real::before { content: ".fake"; }';
    const inv = parseCss(src, 'g.css');
    expect(declNames(inv)).toEqual(['real']);
    expect(declNames(inv)).not.toContain('fake');
  });
});
