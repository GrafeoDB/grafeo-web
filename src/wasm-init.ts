// Namespace import works for both wasm-pack targets:
// - --target web: module has `default` (the __wbg_init fn) + named exports
// - --target bundler: module has only named exports (wasm auto-initializes on import)
import * as wasmModule from '@grafeo-db/wasm';

let initPromise: Promise<void> | null = null;

/**
 * Ensures the WASM module is initialized exactly once.
 *
 * Uses a promise singleton so concurrent `create()` calls share the
 * same initialization and the module is never loaded twice.
 *
 * If the WASM build targets `bundler`, the module auto-initializes on
 * import and there is no `default` export to call; we resolve immediately.
 */
export function ensureWasmInitialized(): Promise<void> {
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
