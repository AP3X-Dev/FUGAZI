import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'conformance/__tests__/**/*.test.ts',
      'fixtures/__tests__/**/*.test.ts',
      'ecosystem/__tests__/**/*.test.ts',
      'property/**/*.test.ts',
      'regression/__tests__/**/*.test.ts',
      'distribution/__tests__/**/*.test.ts',
      'security/__tests__/**/*.test.ts',
      'perf/__tests__/**/*.test.ts',
      'dogfood/__tests__/**/*.test.ts',
    ],
    passWithNoTests: true,
    testTimeout: 120_000,
  },
});
