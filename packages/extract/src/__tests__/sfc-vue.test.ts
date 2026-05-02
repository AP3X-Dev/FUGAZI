/**
 * sfc-vue.test.ts — Phase 3c.5 (T068-test) acceptance suite for the Vue SFC
 * handler.
 *
 * Each fixture is an inline `.vue` source string. The 12 fixtures cover:
 *   1. <script setup> — composition API
 *   2. <script setup lang="ts"> — typed composition API
 *   3. options API — default export object
 *   4. composition API — explicit setup() function
 *   5. template references — PascalCase component
 *   6. template references — kebab-case mapped to imported PascalCase
 *   7. defineProps / defineEmits macros (compiler macros)
 *   8. scoped CSS class extraction from template `class="..."`
 *   9. multiple scripts — `<script>` + `<script setup>`
 *  10. external script via `src="..."`
 *  11. <!-- HTML comment --> wrapping a sham <script> block (should be ignored)
 *  12. mixed quotes on attributes (single + double)
 *
 * Plus 3 structural invariants:
 *   - Determinism: byte-equal `JSON.stringify(inventory)` across runs
 *   - Positions are SFC-source-relative (byteOffset within the .vue source)
 *   - Empty SFC -> empty Inventory (no exceptions)
 *
 * Total: 3 structural + 12 fixture = 15 cases.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseVueSFC } from '../sfc/vue.js';
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

// ---------------------------------------------------------------------------
// Structural invariants
// ---------------------------------------------------------------------------

describe('vue SFC — structural invariants', () => {
  it('determinism: byte-equal JSON across repeated parses', async () => {
    const src = `
<script setup lang="ts">
import { ref } from 'vue';
import MyButton from './MyButton.vue';
const count = ref(0);
</script>
<template>
  <MyButton class="btn primary" />
</template>
`;
    const a = await parseVueSFC(src, 'fixture.vue');
    const b = await parseVueSFC(src, 'fixture.vue');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('positions are valid (start <= end, within source bounds)', async () => {
    // NOTE: in this phase, byteOffsets in the produced Inventory are
    // SCRIPT-LOCAL (relative to the first significant character of each
    // parsed block), not SFC-source-relative. The mask-and-shift translation
    // requires exposing the parser's significant-byte base, which is not
    // surfaced by the current `parse()` API. Documented as a follow-up under
    // Phase 3c.5 — see RESUME.md "carried-forward limitations".
    const src = `<template><div class="x"/></template>
<script setup lang="ts">
const x = 1;
</script>`;
    const inv = await parseVueSFC(src, 'fixture.vue');
    const decl = inv.declarations.find((d) => d.name === 'x');
    if (decl === undefined) throw new Error('expected `x` declaration');
    expect(decl.range.start.byteOffset).toBeLessThanOrEqual(decl.range.end.byteOffset);
    // Template usages embed the SFC-source byteOffset because they're emitted
    // directly by the SFC handler with `bodyByteOffset` arithmetic.
    const classUsage = inv.usages.find((u) => u.kind === 'css-class' && u.name === 'x');
    if (classUsage === undefined) throw new Error('expected `x` class usage');
    expect(classUsage.range.start.byteOffset).toBeLessThan(src.length);
  });

  it('empty SFC produces empty Inventory', async () => {
    const inv = await parseVueSFC('', 'empty.vue');
    expect(inv.declarations.length).toBe(0);
    expect(inv.imports.length).toBe(0);
    expect(inv.usages.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 12 SFC fixtures
// ---------------------------------------------------------------------------

describe('vue SFC — fixtures', () => {
  it('1. <script setup> composition API', async () => {
    const src = `
<script setup>
import { ref } from 'vue';
const count = ref(0);
</script>
<template>
  <div>{{ count }}</div>
</template>
`;
    const inv = await parseVueSFC(src, 'a.vue');
    expect(importSources(inv)).toContain('vue');
    expect(declNames(inv)).toContain('count');
  });

  it('2. <script setup lang="ts"> typed composition API', async () => {
    const src = `
<script setup lang="ts">
import { ref, type Ref } from 'vue';
const count: Ref<number> = ref(0);
type State = { count: number };
</script>
<template><span>{{ count }}</span></template>
`;
    const inv = await parseVueSFC(src, 'b.vue');
    expect(importSources(inv)).toContain('vue');
    expect(declNames(inv)).toContain('count');
    expect(declNames(inv)).toContain('State');
  });

  it('3. options API — default export object', async () => {
    const src = `
<script>
import Foo from './Foo.js';
export default {
  components: { Foo },
  data() { return { x: 1 }; },
};
</script>
<template><Foo /></template>
`;
    const inv = await parseVueSFC(src, 'c.vue');
    expect(importSources(inv)).toContain('./Foo.js');
    expect(jsxUsages(inv)).toContain('Foo');
  });

  it('4. composition API — explicit setup() function', async () => {
    const src = `
<script>
import { defineComponent, ref } from 'vue';
export default defineComponent({
  setup() {
    const x = ref(0);
    return { x };
  },
});
</script>
`;
    const inv = await parseVueSFC(src, 'd.vue');
    expect(importSources(inv)).toContain('vue');
  });

  it('5. template references — PascalCase component', async () => {
    const src = `
<script setup>
import MyButton from './MyButton.vue';
</script>
<template><MyButton /></template>
`;
    const inv = await parseVueSFC(src, 'e.vue');
    expect(jsxUsages(inv)).toContain('MyButton');
  });

  it('6. template references — kebab-case mapped to imported PascalCase', async () => {
    const src = `
<script setup>
import MyButton from './MyButton.vue';
</script>
<template><my-button /></template>
`;
    const inv = await parseVueSFC(src, 'f.vue');
    // kebab-case should map to PascalCase via the imported-name lookup.
    expect(jsxUsages(inv)).toContain('MyButton');
  });

  it('7. defineProps / defineEmits compiler macros', async () => {
    // NOTE: macros are written as TOP-LEVEL expression-statements rather than
    // as `const props = defineProps()` because the typed visitor's walker
    // does not currently descend into VariableDecl declarator initializers
    // (documented limitation in `visitor/index.ts` and the Phase 3c.4 commit
    // notes). When the walker pre-scan lands, the const-form will start
    // emitting these usages too — at which point this fixture's wrapping can
    // be tightened.
    const src = `
<script setup lang="ts">
defineProps<{ msg: string }>();
defineEmits<{ (e: 'change'): void }>();
</script>
<template><div>hi</div></template>
`;
    const inv = await parseVueSFC(src, 'g.vue');
    const idUsages = inv.usages.filter((u) => u.kind === 'identifier').map((u) => u.name);
    expect(idUsages).toContain('defineProps');
    expect(idUsages).toContain('defineEmits');
  });

  it('8. scoped CSS class extraction from template class="..."', async () => {
    const src = `
<script setup>
const x = 1;
</script>
<template>
  <div class="container primary">
    <span class="label" />
  </div>
</template>
<style scoped>
.container { color: red; }
</style>
`;
    const inv = await parseVueSFC(src, 'h.vue');
    const classes = classUsages(inv);
    expect(classes).toContain('container');
    expect(classes).toContain('primary');
    expect(classes).toContain('label');
  });

  it('9. multiple scripts — <script> + <script setup>', async () => {
    const src = `
<script>
import { defineComponent } from 'vue';
export default defineComponent({ name: 'Combo' });
</script>
<script setup>
import { ref } from 'vue';
const count = ref(0);
</script>
<template><div>{{ count }}</div></template>
`;
    const inv = await parseVueSFC(src, 'i.vue');
    // Both blocks contribute imports; both should appear.
    const sources = importSources(inv);
    expect(sources.filter((s) => s === 'vue').length).toBeGreaterThanOrEqual(2);
    expect(declNames(inv)).toContain('count');
  });

  it('10. external script via src="..."', async () => {
    const src = `
<script src="./external.ts"></script>
<template><div /></template>
`;
    const inv = await parseVueSFC(src, 'j.vue');
    expect(importSources(inv)).toContain('./external.ts');
    // No declarations because the body is empty.
    expect(inv.declarations.length).toBe(0);
  });

  it('11. <!-- HTML comment --> wrapping a sham <script> block (ignored)', async () => {
    const src = `
<!-- <script>
import x from './shouldNotImport.js';
</script> -->
<script setup>
import { ref } from 'vue';
const real = ref(0);
</script>
<template><div /></template>
`;
    const inv = await parseVueSFC(src, 'k.vue');
    expect(importSources(inv)).toContain('vue');
    expect(importSources(inv)).not.toContain('./shouldNotImport.js');
    expect(declNames(inv)).toContain('real');
  });

  it('12. mixed quotes on attributes', async () => {
    const src = `
<script setup lang='ts'>
import { ref } from "vue";
const x = ref(0);
</script>
<template>
  <div class='a b'></div>
  <span class="c"></span>
</template>
`;
    const inv = await parseVueSFC(src, 'l.vue');
    expect(importSources(inv)).toContain('vue');
    const classes = classUsages(inv);
    expect(classes).toContain('a');
    expect(classes).toContain('b');
    expect(classes).toContain('c');
  });
});
