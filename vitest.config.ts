import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/types.ts'],
    },
  },
  // Setup for integration and E2E tests
  overrides: [
    {
      include: ['**/pearl*.test.ts', '**/e2e/*.test.ts', '**/integration/*.test.ts', '**/server.test.ts', '**/cli.test.ts'],
      test: {
        setupFiles: ['tests/setup.ts', 'tests/integration-setup.ts'],
      },
    },
  ],
});
