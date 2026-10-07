import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/core/**/*.ts', 'src/auth/**/*.ts'],
      exclude: [
        'src/**/index.ts',
        'src/**/types.ts',
      ],
      thresholds: {
        lines: 90,
        functions: 85,
        branches: 80,
        statements: 90,
      },
    },
  },
});
