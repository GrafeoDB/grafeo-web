import init from '@grafeo-db/wasm';

let initPromise: Promise<void> | null = null;

/**
 * Ensures the WASM module is initialized exactly once.
 *
 * Uses a promise singleton so concurrent `create()` calls share the
 * same initialization and the module is never loaded twice.
 */
export function ensureWasmInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = init().then(() => undefined);
  }
  return initPromise;
}
