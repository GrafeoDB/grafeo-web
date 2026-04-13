import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@grafeo-db/wasm': path.resolve(__dirname, 'src/__mocks__/wasm.ts'),
      '@grafeo-db/wasm-lite': path.resolve(__dirname, 'src/__mocks__/wasm.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
    fileParallelism: false,
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
    },
  },
});
