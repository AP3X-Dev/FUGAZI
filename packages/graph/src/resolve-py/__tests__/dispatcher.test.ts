/**
 * dispatcher.test.ts — Phase 4b T322 acceptance suite for the unified
 * resolver dispatcher's Python branch. Verifies that:
 *   - .py / .pyi files route through the Python chain.
 *   - .ts / .js files still route through the TS chain (no regression).
 *   - mixed-language projects don't cross-contaminate.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryFsAdapter } from '../../resolve/fs-adapter.js';
import { resolve } from '../../resolve/index.js';
import { EMPTY_PYTHON_MANIFEST } from '../manifest.js';

describe('Resolver dispatcher — Python branch (T322)', () => {
  it('returns kind=builtin for stdlib imports from .py files', () => {
    const fs = createMemoryFsAdapter({
      '/proj/main.py': '',
    });
    const r = resolve('os', '/proj/main.py', {
      projectRoot: '/proj',
      fs,
      pythonManifest: EMPTY_PYTHON_MANIFEST,
    });
    expect(r).toEqual({ kind: 'builtin', source: 'os' });
  });

  it('returns kind=builtin for dotted stdlib imports', () => {
    const fs = createMemoryFsAdapter({
      '/proj/main.py': '',
    });
    const r = resolve('urllib.request', '/proj/main.py', {
      projectRoot: '/proj',
      fs,
      pythonManifest: EMPTY_PYTHON_MANIFEST,
    });
    expect(r).toEqual({ kind: 'builtin', source: 'urllib.request' });
  });

  it('resolves Python relative imports to project files', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pkg/__init__.py': '',
      '/proj/pkg/mod.py': '',
      '/proj/pkg/foo.py': '',
    });
    const r = resolve('.foo', '/proj/pkg/mod.py', {
      projectRoot: '/proj',
      fs,
      pythonManifest: EMPTY_PYTHON_MANIFEST,
    });
    expect(r).toEqual({ kind: 'resolved', target: '/proj/pkg/foo.py' });
  });

  it('resolves absolute Python imports via sys.path', () => {
    const fs = createMemoryFsAdapter({
      '/proj/main.py': '',
      '/proj/utils.py': '',
    });
    const r = resolve('utils', '/proj/main.py', {
      projectRoot: '/proj',
      fs,
      pythonManifest: EMPTY_PYTHON_MANIFEST,
    });
    expect(r).toEqual({ kind: 'resolved', target: '/proj/utils.py' });
  });

  it('reports declared external when the import is in the manifest', () => {
    const fs = createMemoryFsAdapter({
      '/proj/main.py': '',
      '/proj/pyproject.toml': '[project]\nname = "x"\ndependencies = ["requests>=2.25"]\n',
    });
    const r = resolve('requests', '/proj/main.py', {
      projectRoot: '/proj',
      fs,
    });
    expect(r).toEqual({ kind: 'external', source: 'requests' });
  });

  it('reports virtualenv-resolved imports as external', () => {
    const fs = createMemoryFsAdapter({
      '/proj/main.py': '',
      '/proj/.venv/Lib/site-packages/flask/__init__.py': '',
    });
    const r = resolve('flask', '/proj/main.py', {
      projectRoot: '/proj',
      fs,
      pythonManifest: EMPTY_PYTHON_MANIFEST,
    });
    expect(r).toEqual({ kind: 'external', source: 'flask' });
  });

  it('reports unresolved when import is neither stdlib, project, nor declared/installed', () => {
    const fs = createMemoryFsAdapter({
      '/proj/main.py': '',
    });
    const r = resolve('mystery_pkg', '/proj/main.py', {
      projectRoot: '/proj',
      fs,
      pythonManifest: EMPTY_PYTHON_MANIFEST,
    });
    expect(r).toEqual({ kind: 'unresolved', source: 'mystery_pkg' });
  });

  it('TS files still resolve through the TS chain (no Python regression)', () => {
    const fs = createMemoryFsAdapter({
      '/proj/src/index.ts': '',
      '/proj/src/foo.ts': '',
    });
    const r = resolve('./foo', '/proj/src/index.ts', {
      projectRoot: '/proj',
      fs,
    });
    expect(r).toEqual({ kind: 'resolved', target: '/proj/src/foo.ts' });
  });

  it('.pyi files dispatch through the Python branch', () => {
    const fs = createMemoryFsAdapter({
      '/proj/main.pyi': '',
    });
    const r = resolve('typing', '/proj/main.pyi', {
      projectRoot: '/proj',
      fs,
      pythonManifest: EMPTY_PYTHON_MANIFEST,
    });
    expect(r).toEqual({ kind: 'builtin', source: 'typing' });
  });

  it('mixed-language project: TS and Py files resolve via their own chains', () => {
    const fs = createMemoryFsAdapter({
      '/proj/web/index.ts': '',
      '/proj/web/util.ts': '',
      '/proj/api/main.py': '',
      '/proj/api/helpers.py': '',
    });
    // TS: relative ./util via TS chain.
    const tsRes = resolve('./util', '/proj/web/index.ts', {
      projectRoot: '/proj',
      fs,
    });
    expect(tsRes).toEqual({ kind: 'resolved', target: '/proj/web/util.ts' });
    // Python: absolute import resolves via sys.path. Since /proj is sys.path
    // root and api/helpers.py is at api.helpers.
    const pyRes = resolve('api.helpers', '/proj/api/main.py', {
      projectRoot: '/proj',
      fs,
      pythonManifest: EMPTY_PYTHON_MANIFEST,
    });
    expect(pyRes).toEqual({ kind: 'resolved', target: '/proj/api/helpers.py' });
  });

  it('PEP 503 normalization applies to the manifest lookup', () => {
    const fs = createMemoryFsAdapter({
      '/proj/main.py': '',
      '/proj/pyproject.toml':
        '[project]\nname = "x"\ndependencies = ["Django-REST-Framework>=3.14"]\n',
    });
    // Import name is `rest_framework`'s parent — we test the normalization
    // path: declared as `Django-REST-Framework` → normalized to
    // `django-rest-framework`. Importing `django_rest_framework` (with
    // underscores) should normalize to the same and match.
    const r = resolve('django_rest_framework', '/proj/main.py', {
      projectRoot: '/proj',
      fs,
    });
    expect(r).toEqual({ kind: 'external', source: 'django_rest_framework' });
  });

  it('empty specifier returns unresolved without crashing', () => {
    const fs = createMemoryFsAdapter({
      '/proj/main.py': '',
    });
    const r = resolve('', '/proj/main.py', {
      projectRoot: '/proj',
      fs,
      pythonManifest: EMPTY_PYTHON_MANIFEST,
    });
    expect(r).toEqual({ kind: 'unresolved', source: '' });
  });
});
