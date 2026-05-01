// Mirrors the user-facing pattern: `import { defineConfig } from 'fugazi'`.
// Locally we re-import the helper from the @fugazi/config package source so
// the fixture is self-contained at test time.
import { defineConfig } from '../../../src/define-config.js';

export default defineConfig({
  rules: {
    'unused-files': 'warn',
  },
  include: ['src/**/*.ts'],
  exclude: ['node_modules', 'dist', 'build', 'coverage'],
  production: true,
  strict: false,
  experimentalTsPlugins: false,
});
