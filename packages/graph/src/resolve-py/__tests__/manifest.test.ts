/**
 * manifest.test.ts — Phase 4b T316 acceptance suite for the Python manifest
 * parser. Covers each format, precedence, PEP 503 normalization, and edge
 * cases (non-literal setup.py, requirements directives).
 */

import { describe, expect, it } from 'vitest';
import { createMemoryFsAdapter } from '../../resolve/fs-adapter.js';
import {
  EMPTY_PYTHON_MANIFEST,
  extractRequirementName,
  loadPythonManifest,
  normalizePackageName,
} from '../manifest.js';

describe('Python manifest parser (T316)', () => {
  it('parses pyproject.toml [project.dependencies] (PEP 621)', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pyproject.toml':
        '[project]\nname = "x"\ndependencies = ["django>=4.0,<5.0", "numpy[extra]>=1.20", "requests; python_version<\\"3.10\\""]\n',
    });
    const m = loadPythonManifest('/proj', fs);
    expect(m.source).toBe('pyproject');
    expect(m.runtime.has('django')).toBe(true);
    expect(m.runtime.has('numpy')).toBe(true);
    expect(m.runtime.has('requests')).toBe(true);
    expect(m.all.size).toBe(3);
  });

  it('parses pyproject.toml [project.optional-dependencies] (PEP 621)', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pyproject.toml':
        '[project]\nname = "x"\ndependencies = ["a"]\n[project.optional-dependencies]\ntest = ["pytest>=7.0", "coverage"]\ndocs = ["sphinx"]\n',
    });
    const m = loadPythonManifest('/proj', fs);
    expect(m.runtime.has('a')).toBe(true);
    expect(m.optional.has('pytest')).toBe(true);
    expect(m.optional.has('coverage')).toBe(true);
    expect(m.optional.has('sphinx')).toBe(true);
    expect(m.dev.has('pytest')).toBe(true); // optional ⊆ dev
    expect(m.all.has('pytest')).toBe(true);
  });

  it('parses pyproject.toml [tool.poetry.*] sections', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pyproject.toml':
        '[tool.poetry]\nname = "x"\n[tool.poetry.dependencies]\npython = "^3.11"\nDjango = "^4.0"\nnumpy = "*"\n[tool.poetry.dev-dependencies]\npytest = "^7.0"\n[tool.poetry.group.docs.dependencies]\nsphinx = "*"\n',
    });
    const m = loadPythonManifest('/proj', fs);
    expect(m.runtime.has('django')).toBe(true);
    expect(m.runtime.has('numpy')).toBe(true);
    expect(m.runtime.has('python')).toBe(false); // python is special
    expect(m.dev.has('pytest')).toBe(true);
    expect(m.dev.has('sphinx')).toBe(true);
  });

  it('parses pyproject.toml [tool.uv.sources] and [tool.uv.dev-dependencies]', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pyproject.toml':
        '[project]\nname = "x"\ndependencies = ["a"]\n[tool.uv.sources]\nb = { path = "../b" }\n[tool.uv]\ndev-dependencies = ["pytest"]\n',
    });
    const m = loadPythonManifest('/proj', fs);
    expect(m.runtime.has('a')).toBe(true);
    expect(m.runtime.has('b')).toBe(true); // uv.sources adds to runtime
    expect(m.dev.has('pytest')).toBe(true);
  });

  it('falls back to setup.cfg when pyproject.toml is absent', () => {
    const fs = createMemoryFsAdapter({
      '/proj/setup.cfg':
        '[options]\ninstall_requires =\n    requests>=2.25\n    flask\n[options.extras_require]\ntest =\n    pytest\n',
    });
    const m = loadPythonManifest('/proj', fs);
    expect(m.source).toBe('setup-cfg');
    expect(m.runtime.has('requests')).toBe(true);
    expect(m.runtime.has('flask')).toBe(true);
    expect(m.dev.has('pytest')).toBe(true);
  });

  it('falls back to setup.py with literal install_requires list', () => {
    const fs = createMemoryFsAdapter({
      '/proj/setup.py':
        'from setuptools import setup\nsetup(\n  name="x",\n  install_requires=["click>=8.0", "rich"],\n)\n',
    });
    const m = loadPythonManifest('/proj', fs);
    expect(m.source).toBe('setup-py');
    expect(m.runtime.has('click')).toBe(true);
    expect(m.runtime.has('rich')).toBe(true);
  });

  it('returns empty manifest when setup.py uses non-literal install_requires', () => {
    const fs = createMemoryFsAdapter({
      '/proj/setup.py':
        'from setuptools import setup\nrequires = ["foo"]\nsetup(install_requires=requires)\n',
    });
    const m = loadPythonManifest('/proj', fs);
    // Variable reference → no list extracted → falls through to no-manifest.
    expect(m.source).toBe('none');
  });

  it('falls back to requirements.txt when other manifests are absent', () => {
    const fs = createMemoryFsAdapter({
      '/proj/requirements.txt': 'django>=4.0\n# comment line\nrequests\n\n',
      '/proj/requirements-dev.txt': 'pytest\nblack\n',
    });
    const m = loadPythonManifest('/proj', fs);
    expect(m.source).toBe('requirements');
    expect(m.runtime.has('django')).toBe(true);
    expect(m.runtime.has('requests')).toBe(true);
    expect(m.dev.has('pytest')).toBe(true);
    expect(m.dev.has('black')).toBe(true);
  });

  it('strips pip directives and URL forms from requirements.txt', () => {
    const fs = createMemoryFsAdapter({
      '/proj/requirements.txt':
        '-r other.txt\n--index-url https://pypi.org\n-e git+https://github.com/x/y.git#egg=mypkg\nrequests\nhttps://example.com/foo.tar.gz#egg=urlpkg\n',
    });
    const m = loadPythonManifest('/proj', fs);
    expect(m.runtime.has('requests')).toBe(true);
    expect(m.runtime.has('mypkg')).toBe(true);
    expect(m.runtime.has('urlpkg')).toBe(true);
    // Directives should not appear as packages.
    expect(m.runtime.has('-r')).toBe(false);
    expect(m.runtime.has('other.txt')).toBe(false);
  });

  it('respects the precedence order pyproject > setup.cfg > setup.py > requirements', () => {
    // All four files present — pyproject wins.
    const fs = createMemoryFsAdapter({
      '/proj/pyproject.toml': '[project]\nname = "x"\ndependencies = ["from-pyproject"]\n',
      '/proj/setup.cfg': '[options]\ninstall_requires =\n    from-cfg\n',
      '/proj/setup.py': 'setup(install_requires=["from-py"])\n',
      '/proj/requirements.txt': 'from-req\n',
    });
    const m = loadPythonManifest('/proj', fs);
    expect(m.source).toBe('pyproject');
    expect(m.runtime.has('from-pyproject')).toBe(true);
    expect(m.runtime.has('from-cfg')).toBe(false);
  });

  it('PEP 503 normalizes package names', () => {
    expect(normalizePackageName('Django')).toBe('django');
    expect(normalizePackageName('Django-REST-Framework')).toBe('django-rest-framework');
    expect(normalizePackageName('django_rest_framework')).toBe('django-rest-framework');
    expect(normalizePackageName('django.rest.framework')).toBe('django-rest-framework');
    expect(normalizePackageName('zope__interface')).toBe('zope-interface');
    expect(normalizePackageName('   spaced  ')).toBe('spaced');
  });

  it('extracts package names from PEP 508 specifiers', () => {
    expect(extractRequirementName('django')).toBe('django');
    expect(extractRequirementName('django>=4.0,<5.0')).toBe('django');
    expect(extractRequirementName('numpy[extra1,extra2]>=1.20')).toBe('numpy');
    expect(extractRequirementName('requests; python_version<"3.10"')).toBe('requests');
    expect(extractRequirementName('Django-REST-Framework~=3.14')).toBe('django-rest-framework');
    expect(extractRequirementName('  ')).toBe('');
    expect(extractRequirementName('')).toBe('');
  });

  it('returns EMPTY_PYTHON_MANIFEST when no manifest is found', () => {
    const fs = createMemoryFsAdapter({});
    const m = loadPythonManifest('/proj', fs);
    expect(m).toBe(EMPTY_PYTHON_MANIFEST);
    expect(m.source).toBe('none');
    expect(m.all.size).toBe(0);
  });

  it('handles malformed pyproject.toml gracefully and falls through', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pyproject.toml': '!!!! not valid toml\n=== broken',
      '/proj/requirements.txt': 'fallback\n',
    });
    const m = loadPythonManifest('/proj', fs);
    expect(m.source).toBe('requirements');
    expect(m.runtime.has('fallback')).toBe(true);
  });
});
