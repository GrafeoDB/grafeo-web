import * as wasmModule from '@grafeo-db/wasm-lite';

let initPromise: Promise<void> | null = null;

/**
 * Ensures the lite WASM module (GQL only) is initialized exactly once.
 *
 * Handles both `--target web` (needs default init() call) and
 * `--target bundler` (auto-initializes; no default export).
 */
export function ensureLiteWasmInitialized(): Promise<void> {
  if (!initPromise) {
    const init = (wasmModule as { default?: () => Promise<unknown> }).default;
    if (typeof init === 'function') {
      initPromise = init().then(() => undefined);
    } else {
      initPromise = Promise.resolve();
    }
  }
  return initPromise;
}
