import path from 'path';

export default {
  esbuild: { jsx: 'automatic' },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/venv/**', '**/.venv/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'dist', '**/*.test.ts', '**/*.test.tsx']
    }
  },
  resolve: {
    alias: {
      'express': path.resolve(__dirname, 'apps/api/node_modules/express'),
      'supertest': path.resolve(__dirname, 'apps/api/node_modules/supertest'),
      '@bayora/schemas': path.resolve(__dirname, 'packages/schemas/src'),
      '@bayora/crypto-utils': path.resolve(__dirname, 'packages/crypto-utils/src')
    }
  }
};