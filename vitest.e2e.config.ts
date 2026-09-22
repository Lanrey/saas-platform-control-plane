import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.e2e-spec.ts'],
    exclude: ['test/unit/**', 'node_modules/**'],
    // Integration tests run sequentially to avoid DB conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Longer timeout for DB operations
    testTimeout: 30000,
    hookTimeout: 30000,
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
