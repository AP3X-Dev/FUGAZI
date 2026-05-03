# @fugazi/plugins

Declarative framework plugin system for Fugazi.

Ships 91 bundled plugins (Next.js, Vite, Vitest, Jest, ESLint, TypeScript,
Tailwind, etc.) as JSON data files validated against
[`plugin-schema.json`](../../plugin-schema.json). Plugins:

- mark framework convention files as entry points
- allow-list tooling dependencies (so they don't surface as `unused-deps`)
- declare which exports are framework-used per file pattern (so they don't
  surface as `unused-exports`)

## Public surface

```ts
import {
  PluginDef,
  loadBundledPlugins,
  getActivePlugins,
  detectActivePlugins,
  validatePlugin,
} from '@fugazi/plugins';
```

## v1 limitations (deferred)

- **AST-based config parsing.** The upstream Rust pipeline parses
  `vitest.config.ts` / `jest.config.ts` / `next.config.ts` etc. to extract
  `setupFiles`, `testMatch`, and `pageExtensions` from the AST. The TS port
  ships only the static `entryPoints` / `configPatterns` / `alwaysUsed` / 
  `usedExports` fields. Roughly 40 of the 91 plugins have a Rust
  `resolve_config()`; the porter records the static surface for those and
  flags them in the per-run port report. Dynamic resolution may be added in
  a later phase via per-plugin `resolveConfig` callbacks.
- **`ScopedUsedClassMember` heritage matching.** The schema accepts scoped
  rules (`extends` / `implements` heritage filters) but the v1 unused-class-
  members rule honours only flat `string` member-name entries. The current
  Inventory does not record class heritage, so heritage-constrained scoping
  is a no-op until that visitor enrichment lands.

Both limitations are documented contracts: the schema validates either form,
the loader preserves both, and the registry surfaces both. Downstream rules
silently ignore the deferred fields.
