/**
 * bundled-smoke.test.ts — content-level smoke tests on the most common
 * framework plugins. Ensures the porter preserved the canonical fields
 * byte-for-byte (the glob patterns are what downstream rules consume).
 */

import { describe, expect, it } from 'vitest';
import { getPlugin } from '../registry.js';

describe('nextjs', () => {
  const plugin = getPlugin('nextjs');
  it('exists', () => expect(plugin).toBeDefined());
  it('enabler is "next"', () => expect(plugin?.enablers).toContain('next'));
  it('has runtime role', () => expect(plugin?.entryPointRole).toBe('runtime'));
  it('has app router page entry', () => {
    expect(plugin?.entryPoints).toContain('app/**/page.{ts,tsx,js,jsx}');
  });
  it('has middleware entry', () => {
    expect(plugin?.entryPoints).toContain('middleware.{ts,js}');
  });
  it('treats next-env.d.ts as always-used', () => {
    expect(plugin?.alwaysUsed).toContain('next-env.d.ts');
  });
  it('declares page exports as used', () => {
    const pageRule = plugin?.usedExports.find((u) => u.pattern === 'app/**/page.{ts,tsx,js,jsx}');
    expect(pageRule?.exports).toContain('default');
    expect(pageRule?.exports).toContain('metadata');
  });
  it('declares route HTTP methods as used', () => {
    const routeRule = plugin?.usedExports.find((u) => u.pattern === 'app/**/route.{ts,tsx,js,jsx}');
    expect(routeRule?.exports).toContain('GET');
    expect(routeRule?.exports).toContain('POST');
    expect(routeRule?.exports).toContain('DELETE');
  });
  it('treats virtual server-only/client-only as tooling', () => {
    expect(plugin?.toolingDependencies).toContain('server-only');
    expect(plugin?.toolingDependencies).toContain('client-only');
  });
});

describe('vite', () => {
  const plugin = getPlugin('vite');
  it('exists', () => expect(plugin).toBeDefined());
  it('enabler is "vite"', () => expect(plugin?.enablers).toContain('vite'));
  it('has runtime role', () => expect(plugin?.entryPointRole).toBe('runtime'));
  it('has vite.config patterns', () => {
    expect(plugin?.configPatterns.some((p) => p.includes('vite.config'))).toBe(true);
  });
});

describe('vitest', () => {
  const plugin = getPlugin('vitest');
  it('exists', () => expect(plugin).toBeDefined());
  it('has test role', () => expect(plugin?.entryPointRole).toBe('test'));
  it('has test entry patterns', () => {
    expect(plugin?.entryPoints).toContain('**/*.test.{ts,tsx,js,jsx}');
    expect(plugin?.entryPoints).toContain('**/*.spec.{ts,tsx,js,jsx}');
  });
  it('treats vitest as tooling dep', () => {
    expect(plugin?.toolingDependencies).toContain('vitest');
  });
});

describe('jest', () => {
  const plugin = getPlugin('jest');
  it('exists', () => expect(plugin).toBeDefined());
  it('has test role', () => expect(plugin?.entryPointRole).toBe('test'));
  it('has test entry patterns', () => {
    expect(plugin?.entryPoints).toContain('**/*.test.{ts,tsx,js,jsx}');
  });
  it('declares jest-environment-jsdom as tooling', () => {
    expect(plugin?.toolingDependencies).toContain('jest-environment-jsdom');
  });
});

describe('eslint', () => {
  const plugin = getPlugin('eslint');
  it('exists', () => expect(plugin).toBeDefined());
  it('has eslint and @eslint/js as enablers', () => {
    expect(plugin?.enablers).toContain('eslint');
    expect(plugin?.enablers).toContain('@eslint/js');
  });
  it('treats eslint config as always-used', () => {
    expect(plugin?.alwaysUsed.some((p) => p.includes('eslint.config'))).toBe(true);
  });
});

describe('prettier', () => {
  const plugin = getPlugin('prettier');
  it('exists', () => expect(plugin).toBeDefined());
  it('treats prettier as tooling dep (not unused-dev-dep)', () => {
    expect(plugin?.toolingDependencies).toContain('prettier');
  });
  it('treats .prettierignore as always-used', () => {
    expect(plugin?.alwaysUsed).toContain('.prettierignore');
  });
});

describe('typescript', () => {
  const plugin = getPlugin('typescript');
  it('exists', () => expect(plugin).toBeDefined());
  it('has typescript enabler', () => {
    expect(plugin?.enablers).toContain('typescript');
  });
});

describe('tailwind', () => {
  const plugin = getPlugin('tailwind');
  it('exists', () => expect(plugin).toBeDefined());
  it('has tailwindcss enabler', () => {
    expect(plugin?.enablers).toContain('tailwindcss');
  });
});

describe('react-native', () => {
  const plugin = getPlugin('react-native');
  it('exists', () => expect(plugin).toBeDefined());
  it('has runtime role', () => expect(plugin?.entryPointRole).toBe('runtime'));
});

describe('astro', () => {
  const plugin = getPlugin('astro');
  it('exists', () => expect(plugin).toBeDefined());
  it('has runtime role', () => expect(plugin?.entryPointRole).toBe('runtime'));
});

describe('storybook', () => {
  const plugin = getPlugin('storybook');
  it('exists', () => expect(plugin).toBeDefined());
  it('has @storybook/ prefix enabler', () => {
    expect(plugin?.enablers).toContain('@storybook/');
  });
  it('has stories entry pattern', () => {
    expect(plugin?.entryPoints).toContain('**/*.stories.{ts,tsx,js,jsx,mdx}');
  });
});

describe('react-router', () => {
  const plugin = getPlugin('react-router');
  it('exists', () => expect(plugin).toBeDefined());
  it('has @react-router/dev enabler', () => {
    expect(plugin?.enablers).toContain('@react-router/dev');
  });
  it('declares Layout export on root', () => {
    const rootRule = plugin?.usedExports.find((u) => u.pattern === 'app/root.{ts,tsx,js,jsx}');
    expect(rootRule?.exports).toContain('Layout');
  });
  it('declares loader/action on routes', () => {
    const rule = plugin?.usedExports.find((u) => u.pattern === 'app/routes/**/*.{ts,tsx,js,jsx}');
    expect(rule?.exports).toContain('loader');
    expect(rule?.exports).toContain('action');
  });
});

describe('remix', () => {
  const plugin = getPlugin('remix');
  it('exists', () => expect(plugin).toBeDefined());
  it('has @remix-run enablers', () => {
    expect(plugin?.enablers.some((e) => e.startsWith('@remix-run/'))).toBe(true);
  });
});

describe('sveltekit', () => {
  const plugin = getPlugin('sveltekit');
  it('exists', () => expect(plugin).toBeDefined());
  it('has @sveltejs/kit enabler', () => {
    expect(plugin?.enablers).toContain('@sveltejs/kit');
  });
});

describe('nuxt', () => {
  const plugin = getPlugin('nuxt');
  it('exists', () => expect(plugin).toBeDefined());
  it('has nuxt enabler', () => {
    expect(plugin?.enablers).toContain('nuxt');
  });
});

describe('angular', () => {
  const plugin = getPlugin('angular');
  it('exists', () => expect(plugin).toBeDefined());
  it('has @angular/core enabler', () => {
    expect(plugin?.enablers).toContain('@angular/core');
  });
  it('treats angular.json as always-used', () => {
    expect(plugin?.alwaysUsed).toContain('angular.json');
  });
});

describe('husky', () => {
  const plugin = getPlugin('husky');
  it('exists', () => expect(plugin).toBeDefined());
  it('has husky enabler', () => {
    expect(plugin?.enablers).toContain('husky');
  });
  it('treats .husky/ as always-used', () => {
    expect(plugin?.alwaysUsed).toContain('.husky/**/*');
  });
});

describe('bun', () => {
  const plugin = getPlugin('bun');
  it('exists', () => expect(plugin).toBeDefined());
  it('has bun-types enabler', () => {
    expect(plugin?.enablers).toContain('bun-types');
  });
  it('treats bunfig.toml as always-used', () => {
    expect(plugin?.alwaysUsed).toContain('bunfig.toml');
  });
});
