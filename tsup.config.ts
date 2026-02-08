import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    lite: 'src/lite.ts',
    react: 'src/react.ts',
    vue: 'src/vue.ts',
    svelte: 'src/svelte.ts',
    worker: 'src/worker.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['@grafeo-db/wasm', 'react', 'vue', 'svelte'],
});
