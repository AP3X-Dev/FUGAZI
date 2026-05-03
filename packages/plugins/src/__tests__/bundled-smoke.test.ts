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

/* ------------------------------------------------------------------------ */
/* Phase 4d — Python framework plugins                                      */
/* ------------------------------------------------------------------------ */

describe('django (Phase 4d T348)', () => {
  const plugin = getPlugin('django');
  it('exists', () => expect(plugin).toBeDefined());
  it('uses pip package manager', () => {
    expect(plugin?.packageManager).toBe('pip');
  });
  it('has django enabler', () => {
    expect(plugin?.enablers).toContain('django');
  });
  it('has runtime role', () => {
    expect(plugin?.entryPointRole).toBe('runtime');
  });
  it('treats manage.py as always-used', () => {
    expect(plugin?.alwaysUsed).toContain('manage.py');
  });
  it('treats migrations as always-used', () => {
    expect(plugin?.alwaysUsed).toContain('**/migrations/**.py');
  });
  it('declares views as wholly used', () => {
    const rule = plugin?.usedExports.find((u) => u.pattern === '**/views.py');
    expect(rule?.exports).toContain('*');
  });
  it('exempts Model.Meta and Model.save', () => {
    const modelRule = plugin?.usedClassMembers.find(
      (m) => typeof m === 'object' && m.extends === 'Model',
    );
    expect(modelRule).toBeDefined();
    if (typeof modelRule === 'object' && modelRule !== undefined) {
      expect(modelRule.members).toContain('Meta');
      expect(modelRule.members).toContain('save');
    }
  });
});

describe('flask (Phase 4d T348)', () => {
  const plugin = getPlugin('flask');
  it('exists', () => expect(plugin).toBeDefined());
  it('uses pip package manager', () => {
    expect(plugin?.packageManager).toBe('pip');
  });
  it('declares @app.route as a used decorator', () => {
    expect(plugin?.usedDecorators).toContain('app.route');
  });
  it('declares @blueprint.route as a used decorator', () => {
    expect(plugin?.usedDecorators).toContain('blueprint.route');
  });
});

describe('fastapi (Phase 4d T348)', () => {
  const plugin = getPlugin('fastapi');
  it('exists', () => expect(plugin).toBeDefined());
  it('declares HTTP-method decorators', () => {
    expect(plugin?.usedDecorators).toContain('app.get');
    expect(plugin?.usedDecorators).toContain('app.post');
    expect(plugin?.usedDecorators).toContain('router.get');
  });
  it('declares uvicorn as tooling', () => {
    expect(plugin?.toolingDependencies).toContain('uvicorn');
  });
});

describe('starlette (Phase 4d T348)', () => {
  const plugin = getPlugin('starlette');
  it('exists', () => expect(plugin).toBeDefined());
  it('exempts HTTPEndpoint methods', () => {
    const rule = plugin?.usedClassMembers.find(
      (m) => typeof m === 'object' && m.extends === 'HTTPEndpoint',
    );
    if (typeof rule === 'object' && rule !== undefined) {
      expect(rule.members).toContain('get');
      expect(rule.members).toContain('post');
    }
  });
});

describe('tornado (Phase 4d T348)', () => {
  const plugin = getPlugin('tornado');
  it('exists', () => expect(plugin).toBeDefined());
  it('exempts RequestHandler lifecycle methods', () => {
    const rule = plugin?.usedClassMembers.find(
      (m) => typeof m === 'object' && m.extends === 'RequestHandler',
    );
    if (typeof rule === 'object' && rule !== undefined) {
      expect(rule.members).toContain('prepare');
      expect(rule.members).toContain('on_finish');
    }
  });
});

describe('pytest (Phase 4d T349)', () => {
  const plugin = getPlugin('pytest');
  it('exists', () => expect(plugin).toBeDefined());
  it('has test role', () => {
    expect(plugin?.entryPointRole).toBe('test');
  });
  it('treats conftest.py as always-used', () => {
    expect(plugin?.alwaysUsed).toContain('**/conftest.py');
  });
  it('declares pytest.fixture as a used decorator', () => {
    expect(plugin?.usedDecorators).toContain('pytest.fixture');
  });
  it('declares bare-form fixture as a used decorator', () => {
    expect(plugin?.usedDecorators).toContain('fixture');
  });
  it('exempts every export in test files', () => {
    const rule = plugin?.usedExports.find((u) => u.pattern === '**/test_*.py');
    expect(rule?.exports).toContain('*');
  });
});

describe('unittest (Phase 4d T349)', () => {
  const plugin = getPlugin('unittest');
  it('exists', () => expect(plugin).toBeDefined());
  it('exempts TestCase lifecycle methods', () => {
    const rule = plugin?.usedClassMembers.find(
      (m) => typeof m === 'object' && m.extends === 'TestCase',
    );
    if (typeof rule === 'object' && rule !== undefined) {
      expect(rule.members).toContain('setUp');
      expect(rule.members).toContain('tearDown');
    }
  });
  it('uses fileExists detection (no enabler — stdlib)', () => {
    expect(plugin?.detection?.type).toBe('fileExists');
  });
});

describe('hypothesis (Phase 4d T349)', () => {
  const plugin = getPlugin('hypothesis');
  it('exists', () => expect(plugin).toBeDefined());
  it('declares @given as a used decorator', () => {
    expect(plugin?.usedDecorators).toContain('given');
  });
});

describe('sqlalchemy (Phase 4d T350)', () => {
  const plugin = getPlugin('sqlalchemy');
  it('exists', () => expect(plugin).toBeDefined());
  it('declares alembic as tooling', () => {
    expect(plugin?.toolingDependencies).toContain('alembic');
  });
  it('declares @validates as a used decorator', () => {
    expect(plugin?.usedDecorators).toContain('validates');
  });
});

describe('tortoise (Phase 4d T350)', () => {
  const plugin = getPlugin('tortoise');
  it('exists', () => expect(plugin).toBeDefined());
  it('uses tortoise-orm enabler', () => {
    expect(plugin?.enablers).toContain('tortoise-orm');
  });
});

describe('pydantic (Phase 4d T351)', () => {
  const plugin = getPlugin('pydantic');
  it('exists', () => expect(plugin).toBeDefined());
  it('declares @validator as used', () => {
    expect(plugin?.usedDecorators).toContain('validator');
  });
  it('declares @field_validator as used', () => {
    expect(plugin?.usedDecorators).toContain('field_validator');
  });
  it('exempts BaseModel.Config and model_config', () => {
    const rule = plugin?.usedClassMembers.find(
      (m) => typeof m === 'object' && m.extends === 'BaseModel',
    );
    if (typeof rule === 'object' && rule !== undefined) {
      expect(rule.members).toContain('Config');
      expect(rule.members).toContain('model_config');
    }
  });
});

describe('dataclasses (Phase 4d T351)', () => {
  const plugin = getPlugin('dataclasses');
  it('exists', () => expect(plugin).toBeDefined());
  it('declares @dataclass as a used decorator', () => {
    expect(plugin?.usedDecorators).toContain('dataclass');
  });
});

describe('attrs (Phase 4d T351)', () => {
  const plugin = getPlugin('attrs');
  it('exists', () => expect(plugin).toBeDefined());
  it('declares @define as a used decorator', () => {
    expect(plugin?.usedDecorators).toContain('define');
  });
});

describe('celery (Phase 4d T352)', () => {
  const plugin = getPlugin('celery');
  it('exists', () => expect(plugin).toBeDefined());
  it('treats tasks.py as always-used', () => {
    expect(plugin?.alwaysUsed).toContain('**/tasks.py');
  });
  it('declares @app.task as a used decorator', () => {
    expect(plugin?.usedDecorators).toContain('app.task');
  });
});

describe('rq (Phase 4d T352)', () => {
  const plugin = getPlugin('rq');
  it('exists', () => expect(plugin).toBeDefined());
  it('declares @job as a used decorator', () => {
    expect(plugin?.usedDecorators).toContain('job');
  });
});

describe('dramatiq (Phase 4d T352)', () => {
  const plugin = getPlugin('dramatiq');
  it('exists', () => expect(plugin).toBeDefined());
  it('declares @actor as a used decorator', () => {
    expect(plugin?.usedDecorators).toContain('actor');
  });
});

describe('click (Phase 4d T353)', () => {
  const plugin = getPlugin('click');
  it('exists', () => expect(plugin).toBeDefined());
  it('declares @command and @group as used', () => {
    expect(plugin?.usedDecorators).toContain('command');
    expect(plugin?.usedDecorators).toContain('group');
  });
});

describe('typer (Phase 4d T353)', () => {
  const plugin = getPlugin('typer');
  it('exists', () => expect(plugin).toBeDefined());
  it('declares @app.command as used', () => {
    expect(plugin?.usedDecorators).toContain('app.command');
  });
});

describe('pyramid (Phase 4d T353)', () => {
  const plugin = getPlugin('pyramid');
  it('exists', () => expect(plugin).toBeDefined());
  it('declares @view_config as used', () => {
    expect(plugin?.usedDecorators).toContain('view_config');
  });
});

describe('Phase 4d T354 — tooling-only Python plugins', () => {
  it('black ships toolingDependencies', () => {
    const p = getPlugin('black');
    expect(p?.toolingDependencies).toContain('black');
  });
  it('isort ships toolingDependencies', () => {
    const p = getPlugin('isort');
    expect(p?.toolingDependencies).toContain('isort');
  });
  it('ruff ships toolingDependencies', () => {
    const p = getPlugin('ruff');
    expect(p?.toolingDependencies).toContain('ruff');
  });
  it('mypy ships toolingDependencies', () => {
    const p = getPlugin('mypy');
    expect(p?.toolingDependencies).toContain('mypy');
  });
  it('pyright ships toolingDependencies', () => {
    const p = getPlugin('pyright');
    expect(p?.toolingDependencies).toContain('pyright');
  });
  it('all five tooling plugins use packageManager:pip', () => {
    for (const name of ['black', 'isort', 'ruff', 'mypy', 'pyright']) {
      expect(getPlugin(name)?.packageManager).toBe('pip');
    }
  });
});

/* ------------------------------------------------------------------------ */
/* Phase 4d completion (T356-T360) — final 6 Python plugins → 30/30         */
/* ------------------------------------------------------------------------ */

describe('sqlmodel (Phase 4d T356)', () => {
  const plugin = getPlugin('sqlmodel');
  it('exists', () => expect(plugin).toBeDefined());
  it('uses pip package manager', () => {
    expect(plugin?.packageManager).toBe('pip');
  });
  it('declares sqlmodel as enabler and tooling', () => {
    expect(plugin?.enablers).toContain('sqlmodel');
    expect(plugin?.toolingDependencies).toContain('sqlmodel');
  });
  it('exempts SQLModel.__tablename__ and model_config', () => {
    const rule = plugin?.usedClassMembers.find(
      (m) => typeof m === 'object' && m.extends === 'SQLModel',
    );
    expect(rule).toBeDefined();
    if (typeof rule === 'object' && rule !== undefined) {
      expect(rule.members).toContain('__tablename__');
      expect(rule.members).toContain('model_config');
    }
  });
  it('declares Pydantic-style validator decorators', () => {
    expect(plugin?.usedDecorators).toContain('validator');
    expect(plugin?.usedDecorators).toContain('field_validator');
    expect(plugin?.usedDecorators).toContain('model_validator');
  });
});

describe('polars (Phase 4d T357)', () => {
  const plugin = getPlugin('polars');
  it('exists', () => expect(plugin).toBeDefined());
  it('uses pip package manager', () => {
    expect(plugin?.packageManager).toBe('pip');
  });
  it('declares polars as enabler and tooling', () => {
    expect(plugin?.enablers).toContain('polars');
    expect(plugin?.toolingDependencies).toContain('polars');
  });
  it('is tooling-only (no entry points, no decorators)', () => {
    expect(plugin?.entryPoints).toEqual([]);
    expect(plugin?.usedDecorators).toEqual([]);
    expect(plugin?.usedClassMembers).toEqual([]);
  });
});

describe('alembic (Phase 4d T358)', () => {
  const plugin = getPlugin('alembic');
  it('exists', () => expect(plugin).toBeDefined());
  it('uses pip package manager', () => {
    expect(plugin?.packageManager).toBe('pip');
  });
  it('has runtime role', () => {
    expect(plugin?.entryPointRole).toBe('runtime');
  });
  it('treats migrations/env.py and migrations/versions/**.py as always-used', () => {
    expect(plugin?.alwaysUsed).toContain('**/migrations/env.py');
    expect(plugin?.alwaysUsed).toContain('**/migrations/versions/**.py');
  });
  it('treats alembic/env.py and alembic/versions/**.py as always-used', () => {
    expect(plugin?.alwaysUsed).toContain('**/alembic/env.py');
    expect(plugin?.alwaysUsed).toContain('**/alembic/versions/**.py');
  });
  it('declares alembic.ini as a config pattern', () => {
    expect(plugin?.configPatterns).toContain('alembic.ini');
  });
  it('exempts upgrade/downgrade/revision in versions files', () => {
    const rule = plugin?.usedExports.find((u) => u.pattern === '**/migrations/versions/**.py');
    expect(rule?.exports).toContain('upgrade');
    expect(rule?.exports).toContain('downgrade');
    expect(rule?.exports).toContain('revision');
    expect(rule?.exports).toContain('down_revision');
  });
});

describe('aiohttp (Phase 4d T359)', () => {
  const plugin = getPlugin('aiohttp');
  it('exists', () => expect(plugin).toBeDefined());
  it('uses pip package manager', () => {
    expect(plugin?.packageManager).toBe('pip');
  });
  it('has runtime role', () => {
    expect(plugin?.entryPointRole).toBe('runtime');
  });
  it('declares routes.* HTTP-method decorators', () => {
    expect(plugin?.usedDecorators).toContain('routes.get');
    expect(plugin?.usedDecorators).toContain('routes.post');
    expect(plugin?.usedDecorators).toContain('routes.put');
    expect(plugin?.usedDecorators).toContain('routes.delete');
  });
  it('declares router.* HTTP-method decorators', () => {
    expect(plugin?.usedDecorators).toContain('router.get');
    expect(plugin?.usedDecorators).toContain('router.post');
  });
  it('declares middleware decorator', () => {
    expect(plugin?.usedDecorators).toContain('middleware');
    expect(plugin?.usedDecorators).toContain('web.middleware');
  });
  it('exempts View HTTP-method members', () => {
    const rule = plugin?.usedClassMembers.find(
      (m) => typeof m === 'object' && m.extends === 'View',
    );
    expect(rule).toBeDefined();
    if (typeof rule === 'object' && rule !== undefined) {
      expect(rule.members).toContain('get');
      expect(rule.members).toContain('post');
    }
  });
});

describe('poetry (Phase 4d T360)', () => {
  const plugin = getPlugin('poetry');
  it('exists', () => expect(plugin).toBeDefined());
  it('uses fileExists detection on pyproject.toml', () => {
    expect(plugin?.detection?.type).toBe('fileExists');
    if (plugin?.detection?.type === 'fileExists') {
      expect(plugin.detection.pattern).toBe('pyproject.toml');
    }
  });
  it('declares poetry-core as tooling', () => {
    expect(plugin?.toolingDependencies).toContain('poetry');
    expect(plugin?.toolingDependencies).toContain('poetry-core');
  });
  it('is tooling-only (no entry points, no decorators)', () => {
    expect(plugin?.entryPoints).toEqual([]);
    expect(plugin?.usedDecorators).toEqual([]);
  });
});

describe('uv (Phase 4d T360)', () => {
  const plugin = getPlugin('uv');
  it('exists', () => expect(plugin).toBeDefined());
  it('uses fileExists detection on uv.lock', () => {
    expect(plugin?.detection?.type).toBe('fileExists');
    if (plugin?.detection?.type === 'fileExists') {
      expect(plugin.detection.pattern).toBe('uv.lock');
    }
  });
  it('declares uv as tooling', () => {
    expect(plugin?.toolingDependencies).toContain('uv');
  });
  it('declares uv.lock and pyproject.toml as config patterns', () => {
    expect(plugin?.configPatterns).toContain('uv.lock');
    expect(plugin?.configPatterns).toContain('pyproject.toml');
  });
});
