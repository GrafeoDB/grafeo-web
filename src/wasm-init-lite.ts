import init from '@grafeo-db/wasm-lite';

let initPromise: Promise<void> | null = null;

/**
 * Ensures the lite WASM module (GQL only) is initialized exactly once.
 *
 * Uses a promise singleton so concurrent `create()` calls share the
 * same initialization and the module is never loaded twice.
 */
export function ensureLiteWasmInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = init().then(() => undefined);
  }
  return initPromise;
}
