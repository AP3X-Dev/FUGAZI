import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    passWithNoTests: true,
    // Cold full-project analysis (WASM parser init) can exceed the 5s default
    // on slower CI runners (notably Windows).
    testTimeout: 30000,
  },
});
