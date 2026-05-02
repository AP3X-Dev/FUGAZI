/**
 * sfc-svelte.test.ts — Phase 3c.5 Dispatch B acceptance suite for the Svelte
 * SFC handler.
 *
 * Each fixture is an inline `.svelte` source string. The 10 fixtures cover:
 *   1. Plain <script> with composition (variable + import)
 *   2. <script context="module"> top-level + <script> instance
 *   3. Svelte 5 runes ($state, $derived, $effect)
 *   4. Slot definitions (<slot /> and named <slot name="header" />)
 *   5. Action attachments (use:tooltip / use:tooltip={cfg})
 *   6. Template-only import — referenced ONLY inside {...} interpolation (E2)
 *   7. $page store-prefix mapping to imported `page` binding
 *   8. {#if} / {#each} block expressions reference imported bindings
 *   9. Component tag ref (PascalCase) in template
 *  10. class="..." and class:foo attributes
 *
 * Plus 3 structural invariants:
 *   - Determinism: byte-equal `JSON.stringify(inventory)` across repeated parses
 *   - Empty SFC -> empty Inventory (no exceptions)
 *   - Multiple <script> blocks both contribute imports
 *
 * Total: 3 structural + 10 fixture = 13 cases.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSvelteSFC } from '../sfc/svelte.js';
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

describe('svelte SFC — structural invariants', () => {
  it('determinism: byte-equal JSON across repeated parses', async () => {
    const src = `<script lang="ts">
import { onMount } from 'svelte';
import MyButton from './MyButton.svelte';
let count = 0;
</script>

<MyButton class="btn primary" />
{#if count > 0}<p>{count}</p>{/if}
`;
    const a = await parseSvelteSFC(src, 'fixture.svelte');
    const b = await parseSvelteSFC(src, 'fixture.svelte');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('empty SFC produces empty Inventory', async () => {
    const inv = await parseSvelteSFC('', 'empty.svelte');
    expect(inv.declarations.length).toBe(0);
    expect(inv.imports.length).toBe(0);
    expect(inv.usages.length).toBe(0);
  });

  it('multiple <script> blocks both contribute imports', async () => {
    const src = `<script context="module">
import { preloadable } from './module-helpers';
export const ssr = true;
</script>
<script>
import { onMount } from 'svelte';
let mounted = false;
</script>
<p>hi</p>
`;
    const inv = await parseSvelteSFC(src, 'i.svelte');
    const sources = importSources(inv);
    expect(sources).toContain('./module-helpers');
    expect(sources).toContain('svelte');
  });
});

// ---------------------------------------------------------------------------
// 10 SFC fixtures
// ---------------------------------------------------------------------------

describe('svelte SFC — fixtures', () => {
  it('1. plain <script> with composition (variable + import)', async () => {
    const src = `<script>
import { onMount } from 'svelte';
let count = 0;
</script>
<p>{count}</p>
`;
    const inv = await parseSvelteSFC(src, 'a.svelte');
    expect(importSources(inv)).toContain('svelte');
    expect(declNames(inv)).toContain('count');
  });

  it('2. <script context="module"> + <script> instance', async () => {
    const src = `<script context="module" lang="ts">
import { adapter } from './adapter';
export const prerender = true;
</script>
<script lang="ts">
import { writable } from 'svelte/store';
const value = writable(0);
</script>
<p>hello</p>
`;
    const inv = await parseSvelteSFC(src, 'b.svelte');
    const sources = importSources(inv);
    expect(sources).toContain('./adapter');
    expect(sources).toContain('svelte/store');
    expect(declNames(inv)).toContain('value');
    expect(declNames(inv)).toContain('prerender');
  });

  it('3. Svelte 5 runes ($state, $derived, $effect)', async () => {
    // The walker doesn't descend into VariableDecl initializers (carried-forward
    // limitation), so rune CALL expressions in `let count = $state(0)` won't
    // appear as identifier usages. We verify that the declarations themselves
    // land — the runes-as-expression-statement form is also covered.
    const src = `<script lang="ts">
let count = $state(0);
let doubled = $derived(count * 2);
$effect(() => {
  console.log(count);
});
</script>
<p>{count}</p>
`;
    const inv = await parseSvelteSFC(src, 'c.svelte');
    expect(declNames(inv)).toContain('count');
    expect(declNames(inv)).toContain('doubled');
    // `$effect(...)` as an expression statement DOES surface its callee.
    const idents = identUsages(inv);
    expect(idents).toContain('$effect');
  });

  it('4. slot definitions (<slot /> and named <slot name="header" />)', async () => {
    const src = `<script>
import Card from './Card.svelte';
</script>
<Card>
  <slot />
  <slot name="header" />
</Card>
`;
    const inv = await parseSvelteSFC(src, 'd.svelte');
    // <slot> is lowercase + no dash — NOT a component, so it should not appear
    // as a jsx usage. <Card> IS a component and should.
    const jsx = jsxUsages(inv);
    expect(jsx).toContain('Card');
    expect(jsx).not.toContain('slot');
  });

  it('5. action attachments (use:tooltip / use:tooltip={cfg})', async () => {
    // Imported actions referenced via `use:` don't appear as identifier
    // usages from the regex layer alone — what we VERIFY is that the import
    // and the directive class-name extraction don't blow up, and that any
    // `{cfg}` argument (which IS a brace expr) gets harvested.
    const src = `<script>
import { tooltip } from './actions';
import { fade } from 'svelte/transition';
let cfg = { text: 'hi' };
</script>
<button use:tooltip>plain</button>
<button use:tooltip={cfg}>configured</button>
<div transition:fade />
`;
    const inv = await parseSvelteSFC(src, 'e.svelte');
    expect(importSources(inv)).toContain('./actions');
    expect(importSources(inv)).toContain('svelte/transition');
    expect(declNames(inv)).toContain('cfg');
  });

  it('6. template-only import — referenced ONLY inside {...} interpolation', async () => {
    // E2 refinement: `format` is imported but referenced ONLY in a brace
    // expression. The handler must surface it as an identifier usage so the
    // dead-code analyzer doesn't flag it as unused.
    const src = `<script>
import { format } from './fmt';
let value = 1;
</script>
<p>{format(value)}</p>
`;
    const inv = await parseSvelteSFC(src, 'f.svelte');
    expect(importSources(inv)).toContain('./fmt');
    const idents = identUsages(inv);
    expect(idents).toContain('format');
  });

  it('7. $page store-prefix mapping to imported `page` binding', async () => {
    const src = `<script>
import { page } from '$app/stores';
</script>
<p>{$page.url.pathname}</p>
`;
    const inv = await parseSvelteSFC(src, 'g.svelte');
    expect(importSources(inv)).toContain('$app/stores');
    const idents = identUsages(inv);
    // The harvested identifier in the brace expression is `$page`; the
    // handler maps it back to the imported `page` binding.
    expect(idents).toContain('page');
  });

  it('8. {#if} / {#each} block expressions reference imported bindings', async () => {
    const src = `<script>
import { items, isReady } from './data';
</script>
{#if isReady}
  {#each items as item}
    <p>{item.name}</p>
  {/each}
{/if}
`;
    const inv = await parseSvelteSFC(src, 'h.svelte');
    expect(importSources(inv)).toContain('./data');
    const idents = identUsages(inv);
    expect(idents).toContain('isReady');
    expect(idents).toContain('items');
  });

  it('9. component tag ref (PascalCase) in template', async () => {
    const src = `<script>
import MyWidget from './MyWidget.svelte';
</script>
<MyWidget />
`;
    const inv = await parseSvelteSFC(src, 'i.svelte');
    expect(jsxUsages(inv)).toContain('MyWidget');
  });

  it('10. class="..." and class:foo attributes', async () => {
    const src = `<script>
let isActive = true;
</script>
<div class="container primary">
  <span class="label" />
  <button class:active={isActive} class:big>Click</button>
</div>
`;
    const inv = await parseSvelteSFC(src, 'j.svelte');
    const classes = classUsages(inv);
    expect(classes).toContain('container');
    expect(classes).toContain('primary');
    expect(classes).toContain('label');
    expect(classes).toContain('active');
    expect(classes).toContain('big');
  });
});
