import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules', 'dist', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'dist', '**/*.test.ts', '**/*.test.tsx']
    }
  },
  resolve: {
    alias: {
      '@bayora/schemas': path.resolve(__dirname, 'packages/schemas/src'),
      '@bayora/crypto-utils': path.resolve(__dirname, 'packages/crypto-utils/src')
    }
  }
});