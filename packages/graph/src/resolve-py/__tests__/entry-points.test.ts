import { describe, expect, it } from 'vitest';
import { createMemoryFsAdapter } from '../../resolve/fs-adapter.js';
import { loadPythonEntryPoints } from '../entry-points.js';

describe('loadPythonEntryPoints', () => {
  it('resolves [project.scripts] / gui-scripts / entry-points and poetry scripts to files', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pyproject.toml': [
        '[project.scripts]',
        'mycli = "myapp.cli:main"',
        '',
        '[project.gui-scripts]',
        'mygui = "myapp.gui:run"',
        '',
        '[project.entry-points."some.group"]',
        'plug = "myapp.plugin:Entry"',
        '',
        '[tool.poetry.scripts]',
        'legacy = "myapp.legacy:go"',
        'rich = { callable = "myapp.rich:main" }',
        '',
      ].join('\n'),
      '/proj/myapp/__init__.py': '',
      '/proj/myapp/cli.py': '',
      '/proj/myapp/gui.py': '',
      '/proj/myapp/plugin.py': '',
      '/proj/myapp/legacy.py': '',
      '/proj/myapp/rich.py': '',
    });

    expect(loadPythonEntryPoints('/proj', fs)).toEqual([
      '/proj/myapp/cli.py',
      '/proj/myapp/gui.py',
      '/proj/myapp/legacy.py',
      '/proj/myapp/plugin.py',
      '/proj/myapp/rich.py',
    ]);
  });

  it('drops scripts whose module does not resolve to a discovered file', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pyproject.toml': '[project.scripts]\nok = "pkg.real:main"\nbad = "pkg.missing:main"\n',
      '/proj/pkg/__init__.py': '',
      '/proj/pkg/real.py': '',
    });
    expect(loadPythonEntryPoints('/proj', fs)).toEqual(['/proj/pkg/real.py']);
  });

  it('resolves a module reference with no callable suffix', () => {
    const fs = createMemoryFsAdapter({
      '/proj/pyproject.toml': '[project.scripts]\nrun = "pkg.app"\n',
      '/proj/pkg/__init__.py': '',
      '/proj/pkg/app.py': '',
    });
    expect(loadPythonEntryPoints('/proj', fs)).toEqual(['/proj/pkg/app.py']);
  });

  it('returns [] when pyproject.toml is absent or unparseable', () => {
    expect(loadPythonEntryPoints('/proj', createMemoryFsAdapter({}))).toEqual([]);
    const bad = createMemoryFsAdapter({ '/proj/pyproject.toml': 'this is = = not toml' });
    expect(loadPythonEntryPoints('/proj', bad)).toEqual([]);
  });
});
