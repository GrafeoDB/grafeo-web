import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@grafeo-db/wasm', () => import('./__mocks__/wasm'));

const { createGrafeo } = await import('./svelte');

/** Helper: subscribe to a store and return the latest value + unsubscribe. */
function get<T>(store: { subscribe(fn: (v: T) => void): () => void }): {
  value: () => T;
  unsubscribe: () => void;
} {
  let current: T;
  const unsubscribe = store.subscribe((v) => {
    current = v;
  });
  return { value: () => current!, unsubscribe };
}

describe('createGrafeo (Svelte)', () => {
  let cleanup: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = null;
    }
  });

  it('returns db, loading, error stores and close function', () => {
    const result = createGrafeo();
    cleanup = result.close;

    expect(result.db).toHaveProperty('subscribe');
    expect(result.loading).toHaveProperty('subscribe');
    expect(result.error).toHaveProperty('subscribe');
    expect(typeof result.close).toBe('function');
  });

  it('initial state: loading=true, db=null, error=null', () => {
    const { db, loading, error, close } = createGrafeo();
    cleanup = close;

    const d = get(db);
    const l = get(loading);
    const e = get(error);

    // Synchronous initial values (before async init resolves)
    expect(d.value()).toBe(null);
    expect(l.value()).toBe(true);
    expect(e.value()).toBe(null);

    d.unsubscribe();
    l.unsubscribe();
    e.unsubscribe();
  });

  it('resolves to loading=false, db=instance after init', async () => {
    const { db, loading, close } = createGrafeo();
    cleanup = close;

    const d = get(db);
    const l = get(loading);

    // Wait for async init
    await vi.waitFor(() => {
      expect(l.value()).toBe(false);
    });

    expect(d.value()).not.toBe(null);
    expect(d.value()).toHaveProperty('execute');

    d.unsubscribe();
    l.unsubscribe();
  });

  it('auto-closes when last db subscriber unsubscribes', async () => {
    const { db, loading, close } = createGrafeo();
    cleanup = close;

    const d = get(db);
    const l = get(loading);

    await vi.waitFor(() => {
      expect(l.value()).toBe(false);
    });

    const instance = d.value();
    expect(instance).not.toBe(null);

    // Unsubscribe last subscriber — should trigger auto-close
    d.unsubscribe();
    l.unsubscribe();

    // The instance should now be closed
    // We can't easily check instance.isOpen since auto-close happens
    // synchronously in unsubscribe, but we can verify re-subscribing
    // yields null
    const d2 = get(db);
    expect(d2.value()).toBe(null);
    d2.unsubscribe();

    cleanup = null; // already cleaned up
  });

  it('manual close() sets db to null and notifies subscribers', async () => {
    const { db, loading, close } = createGrafeo();

    const d = get(db);
    const l = get(loading);

    await vi.waitFor(() => {
      expect(l.value()).toBe(false);
    });

    expect(d.value()).not.toBe(null);

    await close();

    expect(d.value()).toBe(null);

    d.unsubscribe();
    l.unsubscribe();
  });

  it('handles creation errors', async () => {
    // Mock GrafeoDB.create to reject
    const { GrafeoDB } = await import('./index');
    const createSpy = vi
      .spyOn(GrafeoDB, 'create')
      .mockRejectedValueOnce(new Error('WASM load failed'));

    const { loading, error, close } = createGrafeo();
    cleanup = close;

    const l = get(loading);
    const e = get(error);

    await vi.waitFor(() => {
      expect(l.value()).toBe(false);
    });

    expect(e.value()).toBeInstanceOf(Error);
    expect(e.value()!.message).toBe('WASM load failed');

    l.unsubscribe();
    e.unsubscribe();
    createSpy.mockRestore();
  });
});
