/**
 * generate.ts — Phase 3k.1 — scaffold representative project fixtures.
 *
 * Run via: bun tests/fixtures/generate.ts
 *
 * Idempotent: re-running overwrites the scaffolded src/ + package.json +
 * tsconfig.json + fugazi.fixture.json for every fixture in the table. It does
 * NOT touch existing `expected.json` files — those are written by the test
 * runner under FUGAZI_FREEZE=1.
 *
 * Themes covered: boundary, re-export, suppression, path-aliases, workspace,
 * frameworks. ~5 per theme = 30+ fixtures.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

interface FixtureSpec {
  readonly theme: string;
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly fixtureConfig?: Record<string, unknown>;
  readonly pkg?: Record<string, unknown>;
}

const TSCONFIG = `{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
`;

function pkgJson(name: string, extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify(
    { name, version: '0.0.0', private: true, type: 'module', ...extra },
    null,
    2,
  )}\n`;
}

const FIXTURES: readonly FixtureSpec[] = [
  // ---------------- BOUNDARY (5) ----------------
  {
    theme: 'boundary',
    name: 'allowed-within-zone',
    files: {
      'src/api/handler.ts': `import { fetchUser } from './service';\nexport function handler(): string {\n  return fetchUser();\n}\n`,
      'src/api/service.ts': `export function fetchUser(): string {\n  return 'user';\n}\n`,
    },
    fixtureConfig: { entrypoints: ['src/api/handler.ts'] },
  },
  {
    theme: 'boundary',
    name: 'violation-api-to-db',
    files: {
      'src/api/handler.ts': `import { db } from '../db/client';\nexport function handler(): unknown {\n  return db();\n}\n`,
      'src/db/client.ts': `export function db(): unknown {\n  return null;\n}\n`,
    },
    fixtureConfig: {
      entrypoints: ['src/api/handler.ts'],
      zones: {
        api: { pattern: ['src/api/**'], canImport: [] },
        db: { pattern: ['src/db/**'], canImport: [] },
      },
    },
  },
  {
    theme: 'boundary',
    name: 'allowed-cross-zone',
    files: {
      'src/api/handler.ts': `import { domain } from '../domain/entity';\nexport function handler(): string {\n  return domain();\n}\n`,
      'src/domain/entity.ts': `export function domain(): string {\n  return 'entity';\n}\n`,
    },
    fixtureConfig: {
      entrypoints: ['src/api/handler.ts'],
      zones: {
        api: { pattern: ['src/api/**'], canImport: ['domain'] },
        domain: { pattern: ['src/domain/**'], canImport: [] },
      },
    },
  },
  {
    theme: 'boundary',
    name: 'multi-zone-violation',
    files: {
      'src/api/a.ts': `import { infraThing } from '../infra/x';\nimport { dbThing } from '../db/y';\nexport function fan(): string {\n  return infraThing() + dbThing();\n}\n`,
      'src/infra/x.ts': `export function infraThing(): string {\n  return 'infra';\n}\n`,
      'src/db/y.ts': `export function dbThing(): string {\n  return 'db';\n}\n`,
    },
    fixtureConfig: {
      entrypoints: ['src/api/a.ts'],
      zones: {
        api: { pattern: ['src/api/**'], canImport: [] },
        infra: { pattern: ['src/infra/**'], canImport: [] },
        db: { pattern: ['src/db/**'], canImport: [] },
      },
    },
  },
  {
    theme: 'boundary',
    name: 'no-zones-configured',
    files: {
      'src/index.ts': `import { x } from './lib';\nexport const y = x;\n`,
      'src/lib.ts': `export const x = 1;\n`,
    },
    fixtureConfig: { entrypoints: ['src/index.ts'] },
  },

  // ---------------- RE-EXPORT (5) ----------------
  {
    theme: 're-export',
    name: 'named-reexport',
    files: {
      'src/index.ts': `export { foo } from './lib';\n`,
      'src/lib.ts': `export const foo = 1;\nexport const unused = 2;\n`,
    },
    fixtureConfig: { entrypoints: ['src/index.ts'] },
  },
  {
    theme: 're-export',
    name: 'default-reexport',
    files: {
      'src/index.ts': `export { default } from './lib';\n`,
      'src/lib.ts': `export default function lib(): number {\n  return 1;\n}\n`,
    },
    fixtureConfig: { entrypoints: ['src/index.ts'] },
  },
  {
    theme: 're-export',
    name: 'star-reexport',
    files: {
      'src/index.ts': `export * from './lib';\n`,
      'src/lib.ts': `export const a = 1;\nexport const b = 2;\n`,
    },
    fixtureConfig: { entrypoints: ['src/index.ts'] },
  },
  {
    theme: 're-export',
    name: 'alias-reexport',
    files: {
      'src/index.ts': `export { foo as bar } from './lib';\n`,
      'src/lib.ts': `export const foo = 1;\n`,
    },
    fixtureConfig: { entrypoints: ['src/index.ts'] },
  },
  {
    theme: 're-export',
    name: 'multi-level-chain',
    files: {
      'src/index.ts': `export { thing } from './a';\n`,
      'src/a.ts': `export { thing } from './b';\n`,
      'src/b.ts': `export { thing } from './c';\n`,
      'src/c.ts': `export const thing = 1;\n`,
    },
    fixtureConfig: { entrypoints: ['src/index.ts'] },
  },

  // ---------------- SUPPRESSION (5) ----------------
  {
    theme: 'suppression',
    name: 'next-line',
    files: {
      'src/index.ts': `export const used = 1;\n`,
      'src/orphan.ts': `// fugazi-ignore-next-line unused-files\nexport const x = 1;\n`,
    },
    fixtureConfig: { entrypoints: ['src/index.ts'] },
  },
  {
    theme: 'suppression',
    name: 'file-level',
    files: {
      'src/index.ts': `export const used = 1;\n`,
      'src/orphan.ts': `// fugazi-ignore-file unused-files\nexport const x = 1;\n`,
    },
    fixtureConfig: { entrypoints: ['src/index.ts'] },
  },
  {
    theme: 'suppression',
    name: 'unknown-token',
    files: {
      'src/index.ts': `// fugazi-ignore-next-line not-a-real-rule\nexport const used = 1;\n`,
    },
    fixtureConfig: { entrypoints: ['src/index.ts'] },
  },
  {
    theme: 'suppression',
    name: 'multi-rule-suppression',
    files: {
      'src/index.ts': `export const used = 1;\n`,
      'src/orphan.ts': `// fugazi-ignore-file unused-files unused-exports\nexport const x = 1;\n`,
    },
    fixtureConfig: { entrypoints: ['src/index.ts'] },
  },

  // ---------------- PATH-ALIASES (5) ----------------
  {
    theme: 'path-aliases',
    name: 'tsconfig-paths',
    files: {
      'src/index.ts': `import { thing } from '@/lib';\nexport const x = thing;\n`,
      'src/lib.ts': `export const thing = 1;\n`,
    },
    fixtureConfig: { entrypoints: ['src/index.ts'] },
  },
  {
    theme: 'path-aliases',
    name: 'tilde-prefix',
    files: {
      'src/index.ts': `import { thing } from '~/lib';\nexport const x = thing;\n`,
      'src/lib.ts': `export const thing = 1;\n`,
    },
    fixtureConfig: { entrypoints: ['src/index.ts'] },
  },
  {
    theme: 'path-aliases',
    name: 'at-prefix',
    files: {
      'src/index.ts': `import { thing } from '@/lib';\nexport const x = thing;\n`,
      'src/lib.ts': `export const thing = 1;\n`,
    },
    fixtureConfig: { entrypoints: ['src/index.ts'] },
  },
  {
    theme: 'path-aliases',
    name: 'hash-private',
    files: {
      'src/index.ts': `import { thing } from '#internal/lib';\nexport const x = thing;\n`,
      'src/lib.ts': `export const thing = 1;\n`,
    },
    fixtureConfig: { entrypoints: ['src/index.ts'] },
  },
  {
    theme: 'path-aliases',
    name: 'package-imports',
    files: {
      'src/index.ts': `import { thing } from '#internal/lib';\nexport const x = thing;\n`,
      'src/lib.ts': `export const thing = 1;\n`,
    },
    fixtureConfig: { entrypoints: ['src/index.ts'] },
    pkg: {
      imports: { '#internal/*': './src/*.ts' },
    },
  },

  // ---------------- WORKSPACE (4) ----------------
  {
    theme: 'workspace',
    name: 'root-only',
    files: {
      'src/index.ts': `import { used } from './lib';\nexport const x = used;\n`,
      'src/lib.ts': `export const used = 1;\n`,
    },
    fixtureConfig: { entrypoints: ['src/index.ts'] },
  },
  {
    theme: 'workspace',
    name: 'bun-workspace-stub',
    files: {
      'packages/app/src/index.ts': `export const main = 1;\n`,
      'packages/lib/src/index.ts': `export const lib = 1;\n`,
    },
    fixtureConfig: { entrypoints: ['packages/app/src/index.ts', 'packages/lib/src/index.ts'] },
    pkg: { workspaces: ['packages/*'] },
  },
  {
    theme: 'workspace',
    name: 'pnpm-workspace-stub',
    files: {
      'packages/app/src/index.ts': `export const main = 1;\n`,
      'packages/lib/src/index.ts': `export const lib = 1;\n`,
      'pnpm-workspace.yaml': `packages:\n  - 'packages/*'\n`,
    },
    fixtureConfig: { entrypoints: ['packages/app/src/index.ts', 'packages/lib/src/index.ts'] },
  },
  {
    theme: 'workspace',
    name: 'nested-workspace',
    files: {
      'packages/app/src/index.ts': `export const main = 1;\n`,
      'packages/app/sub/lib.ts': `export const sub = 1;\n`,
    },
    fixtureConfig: { entrypoints: ['packages/app/src/index.ts'] },
    pkg: { workspaces: ['packages/*'] },
  },

  // ---------------- FRAMEWORKS (10) ----------------
  {
    theme: 'frameworks',
    name: 'next-app-router',
    files: {
      'app/page.tsx': `export default function Page(): JSX.Element {\n  return <div>home</div> as JSX.Element;\n}\n`,
      'app/layout.tsx': `export default function Layout({ children }: { children: unknown }): unknown {\n  return children;\n}\n`,
    },
    pkg: { dependencies: { next: '^15.0.0', react: '^19.0.0' } },
  },
  {
    theme: 'frameworks',
    name: 'next-pages-router',
    files: {
      'pages/index.tsx': `export default function Index(): unknown {\n  return null;\n}\n`,
      'pages/about.tsx': `export default function About(): unknown {\n  return null;\n}\n`,
    },
    pkg: { dependencies: { next: '^14.0.0', react: '^18.0.0' } },
  },
  {
    theme: 'frameworks',
    name: 'vue-basic',
    files: {
      'src/main.ts': `import { hello } from './lib';\nexport const app = hello();\n`,
      'src/lib.ts': `export function hello(): string {\n  return 'hi';\n}\n`,
    },
    fixtureConfig: { entrypoints: ['src/main.ts'] },
    pkg: { dependencies: { vue: '^3.4.0' } },
  },
  {
    theme: 'frameworks',
    name: 'svelte-basic',
    files: {
      'src/main.ts': `export function start(): string {\n  return 'svelte';\n}\n`,
    },
    fixtureConfig: { entrypoints: ['src/main.ts'] },
    pkg: { dependencies: { svelte: '^4.2.0' } },
  },
  {
    theme: 'frameworks',
    name: 'astro-basic',
    files: {
      'src/pages/index.ts': `export const route = '/';\n`,
    },
    fixtureConfig: { entrypoints: ['src/pages/index.ts'] },
    pkg: { dependencies: { astro: '^4.0.0' } },
  },
  {
    theme: 'frameworks',
    name: 'vite-basic',
    files: {
      'src/main.ts': `export function bootstrap(): void {}\n`,
      'vite.config.ts': `export default { plugins: [] };\n`,
    },
    fixtureConfig: { entrypoints: ['src/main.ts'] },
    pkg: { devDependencies: { vite: '^5.0.0' } },
  },
  {
    theme: 'frameworks',
    name: 'vitest-tests',
    files: {
      'src/index.ts': `export function add(a: number, b: number): number {\n  return a + b;\n}\n`,
      'src/index.test.ts': `import { add } from './index';\nimport { expect, test } from 'vitest';\ntest('adds', () => {\n  expect(add(1, 2)).toBe(3);\n});\n`,
    },
    fixtureConfig: { entrypoints: ['src/index.ts'] },
    pkg: { devDependencies: { vitest: '^2.0.0' } },
  },
  {
    theme: 'frameworks',
    name: 'jest-tests',
    files: {
      'src/index.ts': `export function sub(a: number, b: number): number {\n  return a - b;\n}\n`,
      'src/index.test.ts': `import { sub } from './index';\ntest('subs', () => {\n  expect(sub(2, 1)).toBe(1);\n});\n`,
    },
    fixtureConfig: { entrypoints: ['src/index.ts'] },
    pkg: { devDependencies: { jest: '^29.0.0' } },
  },
  {
    theme: 'frameworks',
    name: 'tailwind-config',
    files: {
      'src/index.ts': `export const greeting = 'hi';\n`,
      'tailwind.config.ts': `export default {\n  content: ['./src/**/*.ts'],\n  theme: { extend: {} },\n};\n`,
    },
    fixtureConfig: { entrypoints: ['src/index.ts'] },
    pkg: { devDependencies: { tailwindcss: '^3.4.0' } },
  },
  {
    theme: 'frameworks',
    name: 'storybook-stories',
    files: {
      'src/Button.tsx': `export function Button(): unknown {\n  return null;\n}\n`,
      'src/Button.stories.tsx': `import { Button } from './Button';\nexport default { component: Button };\nexport const Default = { args: {} };\n`,
    },
    fixtureConfig: { entrypoints: ['src/Button.tsx'] },
    pkg: { devDependencies: { '@storybook/react': '^8.0.0' } },
  },
];

function writeFixture(spec: FixtureSpec): void {
  const dir = resolve(HERE, spec.theme, spec.name);
  mkdirSync(dir, { recursive: true });
  // package.json
  writeFileSync(join(dir, 'package.json'), pkgJson(`fugazi-fx-${spec.theme}-${spec.name}`, spec.pkg ?? {}));
  // tsconfig.json
  writeFileSync(join(dir, 'tsconfig.json'), TSCONFIG);
  // fugazi.fixture.json
  if (spec.fixtureConfig !== undefined) {
    writeFileSync(
      join(dir, 'fugazi.fixture.json'),
      `${JSON.stringify(spec.fixtureConfig, null, 2)}\n`,
    );
  }
  // src/* (or other files)
  for (const [rel, contents] of Object.entries(spec.files)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
}

function main(): void {
  for (const spec of FIXTURES) {
    writeFixture(spec);
  }
  // eslint-disable-next-line no-console
  console.log(`Generated ${FIXTURES.length} project fixtures.`);
}

main();
