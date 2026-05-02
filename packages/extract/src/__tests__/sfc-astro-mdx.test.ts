/**
 * sfc-astro-mdx.test.ts — Phase 3c.5 Dispatch C acceptance suite for the
 * Astro and MDX SFC handlers (T072-test + T073).
 *
 * 5 Astro fixtures + 5 MDX fixtures + 3 structural invariants = 13 cases.
 *
 * Astro fixtures:
 *   1. Frontmatter with import + const decl + template
 *   2. `Astro.props` reference in frontmatter (identifier usage)
 *   3. Component tag reference (PascalCase imported)
 *   4. `class="..."` attribute extraction
 *   5. No frontmatter — template-only file
 *
 * MDX fixtures:
 *   1. Top-of-file `import { Foo } from './foo'`
 *   2. `export const meta = ...`
 *   3. `<Component />` JSX in body
 *   4. `{interp}` expression
 *   5. Code fence ```tsx ... ``` — imports inside MUST NOT count
 *
 * Structural invariants:
 *   - Determinism: byte-equal `JSON.stringify(inventory)` across two parses
 *   - Empty Astro / MDX file produces empty Inventory
 *   - Astro frontmatter parsed as TS (a `type Foo = string` produces a
 *     TypeDecl in declarations — proves TS-not-JS)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAstroSFC } from '../sfc/astro.js';
import { parseMdx } from '../sfc/mdx.js';
import type { Inventory } from '../visitor/types.js';
import { type Manifest, __setManifestForTest } from '../wasm/integrity.js';
import { __clearWasmCacheForTest } from '../wasm/load.js';

const REAL_MANIFEST: Manifest = {
  blobs: {
    swc: {
      path: 'node_modules/@swc/wasm/wasm_bg.wasm',
      sha256: 'a400243367e0731a958f97e4cafd76b7282bd361c6a13e65d1d177d32ee125ec',
    },
  },
};

beforeEach(() => {
  __setManifestForTest(REAL_MANIFEST);
  __clearWasmCacheForTest();
});

afterEach(() => {
  __setManifestForTest(null);
  __clearWasmCacheForTest();
});

function declNames(inv: Inventory): string[] {
  return inv.declarations.map((d) => d.name);
}

function declKinds(inv: Inventory): string[] {
  return inv.declarations.map((d) => d.kind);
}

function importSources(inv: Inventory): string[] {
  return inv.imports.map((i) => i.source);
}

function classUsages(inv: Inventory): string[] {
  return inv.usages.filter((u) => u.kind === 'css-class').map((u) => u.name);
}

function jsxUsages(inv: Inventory): string[] {
  return inv.usages.filter((u) => u.kind === 'jsx').map((u) => u.name);
}

function identUsages(inv: Inventory): string[] {
  return inv.usages.filter((u) => u.kind === 'identifier').map((u) => u.name);
}

// ---------------------------------------------------------------------------
// Structural invariants
// ---------------------------------------------------------------------------

describe('astro/mdx — structural invariants', () => {
  it('determinism: byte-equal JSON across repeated parses', async () => {
    const astroSrc = `---
import Layout from './Layout.astro';
const title = 'Hi';
---
<Layout class="page">{title}</Layout>
`;
    const a1 = await parseAstroSFC(astroSrc, 'page.astro');
    const a2 = await parseAstroSFC(astroSrc, 'page.astro');
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2));

    const mdxSrc = `import { Chart } from './Chart';

# Title

<Chart data={value} />
`;
    const m1 = await parseMdx(mdxSrc, 'post.mdx');
    const m2 = await parseMdx(mdxSrc, 'post.mdx');
    expect(JSON.stringify(m1)).toBe(JSON.stringify(m2));
  });

  it('empty file produces empty Inventory (astro + mdx)', async () => {
    const astro = await parseAstroSFC('', 'empty.astro');
    expect(astro.declarations.length).toBe(0);
    expect(astro.imports.length).toBe(0);
    expect(astro.usages.length).toBe(0);

    const mdx = await parseMdx('', 'empty.mdx');
    expect(mdx.declarations.length).toBe(0);
    expect(mdx.imports.length).toBe(0);
    expect(mdx.usages.length).toBe(0);
  });

  it('Astro frontmatter parsed as TS (type alias produces a TypeDecl)', async () => {
    // A bare `type Foo = string;` is a TypeScript-only construct. If the
    // parser were invoked with `lang: 'js'`, this would either error or be
    // dropped. Its survival as a TypeDecl proves TS-not-JS.
    const src = `---
type Foo = string;
const x: Foo = 'hi';
---
<div>{x}</div>
`;
    const inv = await parseAstroSFC(src, 'fm-ts.astro');
    expect(declNames(inv)).toContain('Foo');
    expect(declKinds(inv)).toContain('type');
  });
});

// ---------------------------------------------------------------------------
// Astro fixtures
// ---------------------------------------------------------------------------

describe('astro SFC — fixtures', () => {
  it('1. frontmatter with import + const decl + template', async () => {
    const src = `---
import Layout from '../layouts/Layout.astro';
const title = 'Welcome';
---
<Layout>
  <h1>{title}</h1>
</Layout>
`;
    const inv = await parseAstroSFC(src, 'a.astro');
    expect(importSources(inv)).toContain('../layouts/Layout.astro');
    expect(declNames(inv)).toContain('title');
  });

  it('2. Astro.props reference in frontmatter', async () => {
    // Frontmatter expression statements surface their leading identifier
    // (or member access) through the visitor. `Astro.props;` is a top-level
    // ExpressionStatement that exposes the `Astro` global as a 'member'
    // usage on the MemberExpression's `object` slot. We additionally assert
    // a top-level const survives — destructuring/destructured-pattern
    // decomposition is a documented visitor limitation, so we use a plain
    // identifier binding here.
    const src = `---
type Props = { title: string };
const greeting: string = 'Hi';
Astro.props;
---
<h1>{greeting}</h1>
`;
    const inv = await parseAstroSFC(src, 'b.astro');
    expect(declNames(inv)).toContain('Props');
    expect(declNames(inv)).toContain('greeting');
    const memberOrIdent = inv.usages
      .filter((u) => u.kind === 'identifier' || u.kind === 'member')
      .map((u) => u.name);
    expect(memberOrIdent).toContain('Astro');
  });

  it('3. component tag reference (PascalCase imported)', async () => {
    const src = `---
import Card from './Card.astro';
---
<Card />
`;
    const inv = await parseAstroSFC(src, 'c.astro');
    expect(importSources(inv)).toContain('./Card.astro');
    expect(jsxUsages(inv)).toContain('Card');
  });

  it('4. class="..." attribute extraction', async () => {
    const src = `---
const x = 1;
---
<div class="container primary">
  <span class='label' />
</div>
`;
    const inv = await parseAstroSFC(src, 'd.astro');
    const classes = classUsages(inv);
    expect(classes).toContain('container');
    expect(classes).toContain('primary');
    expect(classes).toContain('label');
  });

  it('5. no frontmatter — template-only file', async () => {
    const src = `<div class="bare">Just template.</div>
<p>No frontmatter at all.</p>
`;
    const inv = await parseAstroSFC(src, 'e.astro');
    expect(inv.declarations.length).toBe(0);
    expect(inv.imports.length).toBe(0);
    expect(classUsages(inv)).toContain('bare');
  });
});

// ---------------------------------------------------------------------------
// MDX fixtures
// ---------------------------------------------------------------------------

describe('mdx — fixtures', () => {
  it('1. top-of-file import { Foo } from "./foo"', async () => {
    const src = `import { Foo } from './foo';

# Heading

Some prose text.
`;
    const inv = await parseMdx(src, 'a.mdx');
    expect(importSources(inv)).toContain('./foo');
  });

  it('2. export const meta = ...', async () => {
    const src = `export const meta = { title: 'Hello' };

# Heading
`;
    const inv = await parseMdx(src, 'b.mdx');
    expect(declNames(inv)).toContain('meta');
  });

  it('3. <Component /> JSX in body', async () => {
    const src = `import { Chart } from './Chart';

# Dashboard

<Chart />
`;
    const inv = await parseMdx(src, 'c.mdx');
    expect(importSources(inv)).toContain('./Chart');
    expect(jsxUsages(inv)).toContain('Chart');
  });

  it('4. {interp} expression intersects imported names', async () => {
    const src = `import { format } from './fmt';
export const value = 1;

# Title

The formatted value is {format(value)}.
`;
    const inv = await parseMdx(src, 'd.mdx');
    expect(importSources(inv)).toContain('./fmt');
    const idents = identUsages(inv);
    expect(idents).toContain('format');
  });

  it('5. code fence imports MUST NOT count', async () => {
    const src = `import { Real } from './real';

# Example

\`\`\`tsx
import { Sham } from './sham';
const fake = 1;
\`\`\`

<Real />
`;
    const inv = await parseMdx(src, 'e.mdx');
    const sources = importSources(inv);
    expect(sources).toContain('./real');
    expect(sources).not.toContain('./sham');
    // `Real` outside the fence should still surface as a JSX usage.
    expect(jsxUsages(inv)).toContain('Real');
  });
});
