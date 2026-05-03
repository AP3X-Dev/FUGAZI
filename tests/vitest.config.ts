import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'conformance/__tests__/**/*.test.ts',
      'fixtures/__tests__/**/*.test.ts',
      'ecosystem/__tests__/**/*.test.ts',
      'property/**/*.test.ts',
      'regression/__tests__/**/*.test.ts',
    ],
    passWithNoTests: true,
    testTimeout: 60_000,
  },
});
