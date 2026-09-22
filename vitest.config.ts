import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.spec.ts',
        '**/*.e2e-spec.ts',
        '**/index.ts',
        'src/main.ts',
        'database/**',
      ],
    },
    include: ['test/unit/**/*.spec.ts'],
    exclude: ['test/integration/**', 'node_modules/**'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@common': resolve(__dirname, 'src/common'),
      '@config': resolve(__dirname, 'src/config'),
      '@auth': resolve(__dirname, 'src/auth'),
      '@organizations': resolve(__dirname, 'src/organizations'),
      '@projects': resolve(__dirname, 'src/projects'),
      '@api-keys': resolve(__dirname, 'src/api-keys'),
      '@oauth': resolve(__dirname, 'src/oauth'),
    },
  },
});
