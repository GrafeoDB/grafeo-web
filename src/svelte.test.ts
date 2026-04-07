import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@grafeo-db/wasm', () => import('./__mocks__/wasm'));

const { createGrafeo, createQuery } = await import('./svelte');
const { GrafeoDB } = await import('./index');
type GrafeoDBInstance = Awaited<ReturnType<typeof GrafeoDB.create>>;

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

describe('T8: subscriber cleanup and db lifecycle (Svelte)', () => {
  it('unsubscribing all db subscribers closes the database', async () => {
    const { db, loading } = createGrafeo();

    const l = get(loading);
    await vi.waitFor(() => {
      expect(l.value()).toBe(false);
    });
    l.unsubscribe();

    // Subscribe to db
    const d = get(db);
    const instance = d.value();
    expect(instance).not.toBe(null);

    // Unsubscribe last db subscriber, which triggers auto-close
    d.unsubscribe();

    // After auto-close, re-subscribing should yield null (db was closed)
    const d2 = get(db);
    expect(d2.value()).toBe(null);
    d2.unsubscribe();
  });

  it('resubscribing after auto-close yields null (db does not reopen automatically)', async () => {
    const { db, loading } = createGrafeo();

    const l = get(loading);
    await vi.waitFor(() => {
      expect(l.value()).toBe(false);
    });
    l.unsubscribe();

    // Subscribe and get the instance
    const d1 = get(db);
    expect(d1.value()).not.toBe(null);

    // Unsubscribe to trigger auto-close
    d1.unsubscribe();

    // Re-subscribe: db should be null (auto-close already happened)
    const d2 = get(db);
    expect(d2.value()).toBe(null);
    d2.unsubscribe();
  });

  it('creating a new createGrafeo after closing the first works independently', async () => {
    // First instance
    const result1 = createGrafeo();
    const l1 = get(result1.loading);
    await vi.waitFor(() => {
      expect(l1.value()).toBe(false);
    });
    l1.unsubscribe();

    // Close the first
    await result1.close();

    // Second instance is independent
    const result2 = createGrafeo();
    const l2 = get(result2.loading);
    await vi.waitFor(() => {
      expect(l2.value()).toBe(false);
    });

    const d2 = get(result2.db);
    expect(d2.value()).not.toBe(null);
    expect(d2.value()).toHaveProperty('execute');

    d2.unsubscribe();
    l2.unsubscribe();
    await result2.close();
  });
});

describe('createQuery (Svelte)', () => {
  it('executes query when db store emits a database', async () => {
    const { db, loading: dbLoading, close } = createGrafeo();

    const dbL = get(dbLoading);
    await vi.waitFor(() => {
      expect(dbL.value()).toBe(false);
    });
    dbL.unsubscribe();

    const { data, loading, error } = createQuery(db, 'MATCH (p:Person) RETURN p.name');
    const d = get(data);
    const l = get(loading);
    const e = get(error);

    await vi.waitFor(() => {
      expect(l.value()).toBe(false);
    });

    expect(d.value()).not.toBe(null);
    expect(e.value()).toBe(null);

    d.unsubscribe();
    l.unsubscribe();
    e.unsubscribe();
    await close();
  });

  it('stays loading when db store has null', () => {
    const nullDb = {
      subscribe(fn: (v: GrafeoDBInstance | null) => void) {
        fn(null);
        return () => {};
      },
    };

    const { loading } = createQuery(nullDb, 'MATCH (n) RETURN n');
    const l = get(loading);

    expect(l.value()).toBe(true);

    l.unsubscribe();
  });

  it('passes ExecuteOptions to execute', async () => {
    const db = await GrafeoDB.create();
    const executeSpy = vi.spyOn(db, 'execute');

    const dbStore = {
      subscribe(fn: (v: GrafeoDBInstance | null) => void) {
        fn(db);
        return () => {};
      },
    };

    const { loading } = createQuery(dbStore, 'MATCH (p:Person) RETURN p.name', { language: 'cypher' });
    const l = get(loading);

    await vi.waitFor(() => {
      expect(l.value()).toBe(false);
    });

    expect(executeSpy).toHaveBeenCalledWith('MATCH (p:Person) RETURN p.name', { language: 'cypher' });

    l.unsubscribe();
    await db.close();
  });

  it('refetch triggers re-execution', async () => {
    const db = await GrafeoDB.create();
    const executeSpy = vi.spyOn(db, 'execute');

    const dbStore = {
      subscribe(fn: (v: GrafeoDBInstance | null) => void) {
        fn(db);
        return () => {};
      },
    };

    const { loading, refetch } = createQuery(dbStore, 'MATCH (n) RETURN n');
    const l = get(loading);

    await vi.waitFor(() => {
      expect(l.value()).toBe(false);
    });

    const callCount = executeSpy.mock.calls.length;
    refetch();

    await vi.waitFor(() => {
      expect(executeSpy.mock.calls.length).toBeGreaterThan(callCount);
    });

    l.unsubscribe();
    await db.close();
  });
});
