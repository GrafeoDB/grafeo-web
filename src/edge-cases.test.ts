/**
 * Edge-case and regression tests.
 *
 * Organized by the *class* of bug, not by component.
 * Each section targets a pattern that has historically slipped through:
 *   1. Lifecycle & resource management (close races, double-close)
 *   2. Regression tests for 0.5.38 fixes (double-init, use-after-free, timer race)
 *   3. Persistence edge cases (concurrent keys, error callbacks, clear during save)
 *   4. Import/export resilience (corrupted data, consecutive imports)
 *   5. Concurrency (parallel operations, rapid create/close)
 *   6. Framework integration (unmount races, reactive teardown)
 *   7. Worker communication (send-after-close, error propagation)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// Suppress React act() warnings
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@grafeo-db/wasm', () => import('./__mocks__/wasm'));

const { GrafeoDB } = await import('./index');
const { PersistenceManager } = await import('./persistence');
const { WorkerProxy } = await import('./worker-proxy');
type GrafeoDBInstance = Awaited<ReturnType<typeof GrafeoDB.create>>;

// Ensure fake timers and spies never leak between tests
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Lifecycle & resource management
// ---------------------------------------------------------------------------
describe('lifecycle & resource management', () => {
  it('double close is idempotent and does not throw', async () => {
    const db = await GrafeoDB.create();
    await db.close();
    await db.close(); // second close should be a no-op
    expect(db.isOpen).toBe(false);
  });

  it('close flushes persistence before releasing WASM', async () => {
    const db = await GrafeoDB.create({ persist: 'flush-test' });
    await db.execute("INSERT (:Person {name: 'Alice'})");
    await db.close();

    // Reopen: persisted data should survive
    const db2 = await GrafeoDB.create({ persist: 'flush-test' });
    const results = await db2.execute('MATCH (p:Person) RETURN p.name');
    expect(results).toHaveLength(1);
    expect(results[0]['p.name']).toBe('Alice');
    await db2.close();

    const pm = new PersistenceManager('flush-test');
    await pm.clear();
  });

  it('all public async methods throw after close', async () => {
    const db = await GrafeoDB.create();
    await db.close();

    const methods: Array<() => Promise<unknown>> = [
      () => db.execute('MATCH (n) RETURN n'),
      () => db.executeRaw('MATCH (n) RETURN n'),
      () => db.nodeCount(),
      () => db.edgeCount(),
      () => db.schema(),
      () => db.export(),
      () => db.import({ version: 1, data: new Uint8Array(), timestamp: 0 }),
      () => db.clear(),
      () => db.storageStats(),
      () => db.changesSince(0),
      () => db.createProjection('p'),
      () => db.dropProjection('p'),
      () => db.listProjections(),
      () => db.setSchema('s'),
      () => db.resetSchema(),
      () => db.currentSchema(),
      () => db.clearPlanCache(),
      () => db.memoryUsage(),
      () => db.info(),
      () => db.importRows([], { mode: 'nodes', label: 'X' }),
      () => db.importLpg({ nodes: [], edges: [] }),
    ];

    for (const fn of methods) {
      await expect(fn()).rejects.toThrow('Database is closed');
    }
  });

  it('create, insert, close, reopen recovers persisted data', async () => {
    const key = 'lifecycle-round-trip';
    const db1 = await GrafeoDB.create({ persist: key });
    await db1.execute("INSERT (:City {name: 'Berlin'})");
    await db1.close();

    const db2 = await GrafeoDB.create({ persist: key });
    expect(await db2.nodeCount()).toBe(1);
    const cities = await db2.execute('MATCH (c:City) RETURN c.name');
    expect(cities[0]['c.name']).toBe('Berlin');
    await db2.close();

    const pm = new PersistenceManager(key);
    await pm.clear();
  });

  it('clear removes data and persisted state', async () => {
    const key = 'clear-test';
    const db = await GrafeoDB.create({ persist: key });
    await db.execute("INSERT (:Person {name: 'Alice'})");
    await db.clear();

    expect(await db.nodeCount()).toBe(0);

    await db.close();
    const db2 = await GrafeoDB.create({ persist: key });
    expect(await db2.nodeCount()).toBe(0);
    await db2.close();

    const pm = new PersistenceManager(key);
    await pm.clear();
  });

  it('getVersion works in direct mode', async () => {
    const db = await GrafeoDB.create();
    const version = await db.getVersion();
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
    await db.close();
  });
});

// ---------------------------------------------------------------------------
// 2. Regression tests for 0.5.38 fixes
// ---------------------------------------------------------------------------
describe('0.5.38 regression: import use-after-free', () => {
  it('failed import leaves database usable', async () => {
    const db = await GrafeoDB.create();
    await db.execute("INSERT (:Person {name: 'Alice'})");

    const badSnapshot = { version: 1, data: new Uint8Array([0xFF]), timestamp: 0 };
    await expect(db.import(badSnapshot)).rejects.toThrow();

    // Database should still be open and usable after failed import
    expect(db.isOpen).toBe(true);
    await db.close();
  });

  it('successful import replaces data completely', async () => {
    const db = await GrafeoDB.create();
    await db.execute("INSERT (:Person {name: 'Alice'})");
    await db.execute("INSERT (:Person {name: 'Bob'})");
    expect(await db.nodeCount()).toBe(2);

    const snapshot = await db.export();
    await db.clear();
    expect(await db.nodeCount()).toBe(0);

    await db.import(snapshot);
    expect(await db.nodeCount()).toBe(2);
    await db.close();
  });

  it('consecutive imports do not leak or corrupt', async () => {
    const db = await GrafeoDB.create();
    await db.execute("INSERT (:Person {name: 'Alice'})");
    const snap1 = await db.export();

    await db.execute("INSERT (:Person {name: 'Bob'})");
    const snap2 = await db.export();

    await db.import(snap1);
    expect(await db.nodeCount()).toBe(1);

    await db.import(snap2);
    expect(await db.nodeCount()).toBe(2);

    await db.close();
  });
});

describe('0.5.38 regression: persistence timer race', () => {
  it('scheduleSave after dispose is a no-op', async () => {
    // Use short interval and real timers (fake timers block IndexedDB)
    const pm = new PersistenceManager('timer-race', 50);
    const getSnapshot = vi.fn(() => new Uint8Array([1]));

    // Schedule, then flush (which disposes)
    pm.scheduleSave(() => new Uint8Array([2]));
    await pm.flush(() => new Uint8Array([2]));

    // Now schedule again after disposed
    pm.scheduleSave(getSnapshot);

    // Wait past debounce interval
    await new Promise((r) => setTimeout(r, 200));

    // getSnapshot from the post-dispose scheduleSave should never fire
    expect(getSnapshot).not.toHaveBeenCalled();

    await pm.clear();
  });

  it('flush cancels pending timer and saves immediately', async () => {
    const pm = new PersistenceManager('flush-cancel', 2000); // long interval
    const snapshot = new Uint8Array([10, 20, 30]);
    const getSnapshot = vi.fn(() => snapshot);

    pm.scheduleSave(getSnapshot);

    // Flush before timer fires
    await pm.flush(getSnapshot);
    expect(getSnapshot).toHaveBeenCalledTimes(1);

    // After flush (disposed), no more saves should occur
    const saveSpy = vi.spyOn(pm, 'save');
    await new Promise((r) => setTimeout(r, 100));
    expect(saveSpy).not.toHaveBeenCalled();

    saveSpy.mockRestore();
    await pm.clear();
  });
});

describe('0.5.38 regression: WorkerProxy double-init', () => {
  it('second init() rejects pending requests from first init', async () => {
    const proxy = new WorkerProxy();

    const OriginalWorker = globalThis.Worker;
    let workerCount = 0;
    // Must use `function` syntax for constructors (not arrow functions)
    globalThis.Worker = vi.fn(function (this: Worker) {
      workerCount++;
      const self = this;
      (self as unknown as Record<string, unknown>).terminate = vi.fn();
      (self as unknown as Record<string, unknown>).postMessage = vi.fn(
        (msg: { id: number; method: string }) => {
          if (msg.method === 'init') {
            setTimeout(() => {
              (self as unknown as { onmessage: ((e: MessageEvent) => void) | null }).onmessage?.(
                { data: { id: msg.id, result: true } } as MessageEvent,
              );
            }, 0);
          }
        },
      );
    }) as unknown as typeof Worker;

    try {
      await proxy.init();
      expect(workerCount).toBe(1);

      // Fire a request that will never get a response.
      // Attach .catch immediately to prevent unhandled rejection warning,
      // since proxy.init() rejects it synchronously during double-init.
      let caughtError: Error | null = null;
      const pendingPromise = proxy.execute('MATCH (n) RETURN n');
      pendingPromise.catch((e: Error) => { caughtError = e; });

      // Init again: should terminate old worker and reject pending
      await proxy.init();
      expect(workerCount).toBe(2);

      // Wait for the catch handler to fire
      await new Promise((r) => setTimeout(r, 10));
      expect(caughtError).toBeInstanceOf(Error);
      expect(caughtError!.message).toBe('Worker re-initialized');
    } finally {
      globalThis.Worker = OriginalWorker;
    }
  });
});

describe('0.5.38 regression: snapshot migration backup', () => {
  it('incompatible snapshot is backed up before clearing', async () => {
    const key = 'backup-regression';
    const backupKey = `${key}__backup`;

    // Seed persistence with a snapshot
    const pm = new PersistenceManager(key);
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    await pm.save(original);

    // Make importSnapshot throw
    const { Database } = await import('./__mocks__/wasm');
    const originalImport = Database.importSnapshot;
    Database.importSnapshot = () => {
      throw new Error('version mismatch');
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const db = await GrafeoDB.create({ persist: key });
      expect(db.isOpen).toBe(true);
      expect(await db.nodeCount()).toBe(0);

      // Backup should exist
      const backupPm = new PersistenceManager(backupKey);
      const backup = await backupPm.load();
      expect(backup).not.toBeNull();
      expect(Array.from(backup!)).toEqual([1, 2, 3, 4, 5]);

      await db.close();
      await backupPm.clear();
    } finally {
      Database.importSnapshot = originalImport;
      warnSpy.mockRestore();
      await pm.clear();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Persistence edge cases
// ---------------------------------------------------------------------------
describe('persistence edge cases', () => {
  it('two managers with the same key see the same data', async () => {
    const pm1 = new PersistenceManager('shared-key');
    const pm2 = new PersistenceManager('shared-key');

    await pm1.save(new Uint8Array([1, 2, 3]));
    const loaded = await pm2.load();
    expect(Array.from(loaded!)).toEqual([1, 2, 3]);

    await pm1.clear();
  });

  it('clear during pending scheduleSave prevents the save', async () => {
    const pm = new PersistenceManager('clear-during-save', 200);
    pm.scheduleSave(() => new Uint8Array([1, 2, 3]));

    // Clear before the timer fires
    await pm.clear();

    // Wait past the debounce
    await new Promise((r) => setTimeout(r, 400));

    const loaded = await pm.load();
    expect(loaded).toBeNull();
  });

  it('custom persistInterval is respected', async () => {
    vi.useFakeTimers();

    const pm = new PersistenceManager('interval-test', 200);
    const getSnapshot = vi.fn(() => new Uint8Array([1]));

    pm.scheduleSave(getSnapshot);

    // At 100ms, should not have fired yet
    await vi.advanceTimersByTimeAsync(100);
    expect(getSnapshot).not.toHaveBeenCalled();

    // At 250ms, should have fired
    await vi.advanceTimersByTimeAsync(150);
    expect(getSnapshot).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    await pm.clear();
  });

  it('onPersistError receives non-Error throwables wrapped as Error', async () => {
    const errors: Error[] = [];
    const pm = new PersistenceManager('error-wrap', 50, (err) => errors.push(err));

    pm.scheduleSave(() => {
      // eslint-disable-next-line no-throw-literal
      throw 'string error';
    });

    await new Promise((r) => setTimeout(r, 200));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(errors[0].message).toBe('string error');

    await pm.clear();
  });

  it('scheduleSave replaces previous pending timer (last write wins)', async () => {
    vi.useFakeTimers();

    const pm = new PersistenceManager('last-write', 200);

    pm.scheduleSave(() => new Uint8Array([1]));
    pm.scheduleSave(() => new Uint8Array([2]));
    pm.scheduleSave(() => new Uint8Array([3])); // this one should win

    await vi.advanceTimersByTimeAsync(300);

    vi.useRealTimers();

    const loaded = await pm.load();
    expect(Array.from(loaded!)).toEqual([3]);

    await pm.clear();
  });

  it('flush on non-dirty manager is a safe no-op', async () => {
    const pm = new PersistenceManager('flush-noop');
    const getSnapshot = vi.fn(() => new Uint8Array([1]));

    // Flush without ever scheduling
    await pm.flush(getSnapshot);
    expect(getSnapshot).not.toHaveBeenCalled();

    // After flush (disposed), scheduleSave is also a no-op
    pm.scheduleSave(getSnapshot);
    await new Promise((r) => setTimeout(r, 200));
    expect(getSnapshot).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Import/export resilience
// ---------------------------------------------------------------------------
describe('import/export resilience', () => {
  it('export returns a valid DatabaseSnapshot shape', async () => {
    const db = await GrafeoDB.create();
    const snapshot = await db.export();

    expect(snapshot).toHaveProperty('version', 1);
    expect(snapshot).toHaveProperty('data');
    expect(snapshot.data).toBeInstanceOf(Uint8Array);
    expect(snapshot).toHaveProperty('timestamp');
    expect(typeof snapshot.timestamp).toBe('number');
    expect(snapshot.timestamp).toBeGreaterThan(0);

    await db.close();
  });

  it('export of empty db produces a valid importable snapshot', async () => {
    const db = await GrafeoDB.create();
    const snapshot = await db.export();
    await db.close();

    const db2 = await GrafeoDB.create();
    await db2.import(snapshot);
    expect(await db2.nodeCount()).toBe(0);
    await db2.close();
  });

  it('import does not share references with source snapshot', async () => {
    const db1 = await GrafeoDB.create();
    await db1.execute("INSERT (:Person {name: 'Alice'})");
    const snapshot = await db1.export();
    const snapshotCopy = new Uint8Array(snapshot.data);

    const db2 = await GrafeoDB.create();
    await db2.import(snapshot);
    await db2.execute("INSERT (:Person {name: 'Bob'})");

    // Original snapshot data unchanged
    expect(Array.from(snapshot.data)).toEqual(Array.from(snapshotCopy));
    expect(await db1.nodeCount()).toBe(1);
    expect(await db2.nodeCount()).toBe(2);

    await db1.close();
    await db2.close();
  });

  it('import triggers persistence save', async () => {
    const key = 'import-persist';
    const db = await GrafeoDB.create({ persist: key });
    await db.execute("INSERT (:Person {name: 'Alice'})");
    const snapshot = await db.export();

    await db.clear();
    await db.import(snapshot);
    expect(await db.nodeCount()).toBe(1);

    // Close and reopen: persistence should have captured the import
    await db.close();
    const db2 = await GrafeoDB.create({ persist: key });
    expect(await db2.nodeCount()).toBe(1);
    await db2.close();

    const pm = new PersistenceManager(key);
    await pm.clear();
  });

  it('changesSince throws with a clear message', async () => {
    const db = await GrafeoDB.create();
    await expect(db.changesSince(0)).rejects.toThrow('not yet implemented');
    await db.close();
  });
});

// ---------------------------------------------------------------------------
// 5. Concurrency
// ---------------------------------------------------------------------------
describe('concurrency', () => {
  it('multiple parallel execute() calls all resolve correctly', async () => {
    const db = await GrafeoDB.create();
    await db.execute("INSERT (:Person {name: 'Alice', age: 30})");
    await db.execute("INSERT (:Person {name: 'Bob', age: 25})");

    const promises = Array.from({ length: 5 }, () =>
      db.execute('MATCH (p:Person) RETURN p.name'),
    );
    const results = await Promise.all(promises);

    for (const result of results) {
      expect(result).toHaveLength(2);
    }

    await db.close();
  });

  it('parallel create + close cycles all complete cleanly', async () => {
    const promises = Array.from({ length: 5 }, async () => {
      const db = await GrafeoDB.create();
      await db.execute("INSERT (:Person {name: 'Test'})");
      expect(await db.nodeCount()).toBe(1);
      await db.close();
      expect(db.isOpen).toBe(false);
    });

    await Promise.all(promises);
  });

  it('rapid create/close cycle with same persist key accumulates data', async () => {
    const key = 'rapid-cycle';

    for (let i = 0; i < 5; i++) {
      const db = await GrafeoDB.create({ persist: key });
      await db.execute(`INSERT (:Item {n: ${i}})`);
      await db.close();
    }

    const db = await GrafeoDB.create({ persist: key });
    expect(await db.nodeCount()).toBe(5);
    await db.close();

    const pm = new PersistenceManager(key);
    await pm.clear();
  });

  it('concurrent databases with different persist keys are isolated', async () => {
    const db1 = await GrafeoDB.create({ persist: 'concurrent-a' });
    const db2 = await GrafeoDB.create({ persist: 'concurrent-b' });

    await db1.execute("INSERT (:Person {name: 'Alice'})");
    await db2.execute("INSERT (:Animal {name: 'Cat'})");

    expect(await db1.nodeCount()).toBe(1);
    expect(await db2.nodeCount()).toBe(1);

    const people = await db1.execute('MATCH (p:Person) RETURN p.name');
    const animals = await db2.execute('MATCH (a:Animal) RETURN a.name');
    expect(people).toHaveLength(1);
    expect(animals).toHaveLength(1);

    await db1.close();
    await db2.close();

    const pm1 = new PersistenceManager('concurrent-a');
    const pm2 = new PersistenceManager('concurrent-b');
    await pm1.clear();
    await pm2.clear();
  });
});

// ---------------------------------------------------------------------------
// 6. Framework integration edge cases
// ---------------------------------------------------------------------------
describe('framework edge cases: Vue unmount race', () => {
  it('unmount before create resolves closes the instance (no leak)', async () => {
    const { createApp, defineComponent } = await import('vue');
    const { useGrafeo } = await import('./vue');

    let resolveCreate!: (db: GrafeoDBInstance) => void;
    const createSpy = vi
      .spyOn(GrafeoDB, 'create')
      .mockImplementation(
        () => new Promise<GrafeoDBInstance>((resolve) => { resolveCreate = resolve; }),
      );

    const app = createApp(
      defineComponent({
        setup() {
          useGrafeo();
          return () => null;
        },
      }),
    );
    const root = document.createElement('div');
    app.mount(root);

    // Unmount before create resolves
    app.unmount();

    // Restore mock BEFORE creating the real db (otherwise create() uses the mock)
    createSpy.mockRestore();

    const realDb = await GrafeoDB.create();
    const closeSpy = vi.spyOn(realDb, 'close');
    resolveCreate(realDb);

    await new Promise((r) => setTimeout(r, 10));
    expect(closeSpy).toHaveBeenCalled();
  });
});

describe('framework edge cases: React unmount race', () => {
  it('unmount before create resolves closes the instance', async () => {
    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { act } = React;
    const { useGrafeo } = await import('./react');

    let resolveCreate!: (db: GrafeoDBInstance) => void;
    const createSpy = vi
      .spyOn(GrafeoDB, 'create')
      .mockImplementation(
        () => new Promise<GrafeoDBInstance>((resolve) => { resolveCreate = resolve; }),
      );

    const container = document.createElement('div');
    document.body.appendChild(container);

    const TestComponent: React.FC = () => {
      useGrafeo();
      return null;
    };

    let root: ReturnType<typeof createRoot>;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(TestComponent));
    });

    // Unmount immediately
    act(() => { root!.unmount(); });

    // Restore mock BEFORE creating the real db
    createSpy.mockRestore();

    const realDb = await GrafeoDB.create();
    const closeSpy = vi.spyOn(realDb, 'close');
    resolveCreate(realDb);

    await new Promise((r) => setTimeout(r, 10));
    expect(closeSpy).toHaveBeenCalled();

    document.body.removeChild(container);
  });
});

describe('framework edge cases: Svelte auto-close vs manual close', () => {
  it('manual close then unsubscribe does not double-close', async () => {
    const { createGrafeo } = await import('./svelte');
    const { db, loading, close } = createGrafeo();

    let currentLoading = true;
    const unsubLoading = loading.subscribe((v) => { currentLoading = v; });
    await vi.waitFor(() => expect(currentLoading).toBe(false));

    let currentDb: GrafeoDBInstance | null = null;
    const unsubDb = db.subscribe((v) => { currentDb = v; });
    expect(currentDb).not.toBeNull();

    const closeSpy = vi.spyOn(currentDb!, 'close');

    // Manual close first
    await close();
    expect(closeSpy).toHaveBeenCalledTimes(1);

    // Unsubscribe after: auto-close path should not throw or double-close
    unsubDb();
    unsubLoading();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('rapid subscribe/unsubscribe cycles do not throw', async () => {
    const { createGrafeo } = await import('./svelte');
    const { db, loading, close } = createGrafeo();

    let currentLoading = true;
    const unsubLoading = loading.subscribe((v) => { currentLoading = v; });
    await vi.waitFor(() => expect(currentLoading).toBe(false));

    for (let i = 0; i < 10; i++) {
      const unsub = db.subscribe(() => {});
      unsub();
    }

    unsubLoading();
    await close();
  });
});

describe('framework edge cases: Svelte createQuery cleanup', () => {
  it('unsubscribing all query stores unsubscribes from db store', async () => {
    const { createGrafeo, createQuery } = await import('./svelte');
    const { db, loading, close } = createGrafeo();

    let currentLoading = true;
    const unsubLoading = loading.subscribe((v) => { currentLoading = v; });
    await vi.waitFor(() => expect(currentLoading).toBe(false));

    const { data, loading: qLoading, error } = createQuery(
      db,
      'MATCH (p:Person) RETURN p.name',
    );

    let qCurrentLoading = true;
    const unsubQLoading = qLoading.subscribe((v) => { qCurrentLoading = v; });
    await vi.waitFor(() => expect(qCurrentLoading).toBe(false));

    const unsubData = data.subscribe(() => {});
    const unsubError = error.subscribe(() => {});

    // Unsubscribe all query stores cleanly
    unsubData();
    unsubError();
    unsubQLoading();

    unsubLoading();
    await close();
  });

  it('query error state is set when execute throws', async () => {
    const { createQuery } = await import('./svelte');

    const db = await GrafeoDB.create();
    vi.spyOn(db, 'execute').mockRejectedValue(new Error('query failed'));

    const dbStore = {
      subscribe(fn: (v: GrafeoDBInstance | null) => void) {
        fn(db);
        return () => {};
      },
    };

    const { error, loading: qLoading } = createQuery(dbStore, 'BAD QUERY');

    let currentError: Error | null = null;
    const unsubError = error.subscribe((v) => { currentError = v; });

    let currentLoading = true;
    const unsubLoading = qLoading.subscribe((v) => { currentLoading = v; });

    await vi.waitFor(() => expect(currentLoading).toBe(false));
    expect(currentError).toBeInstanceOf(Error);
    expect(currentError!.message).toBe('query failed');

    unsubError();
    unsubLoading();
    await db.close();
  });
});

describe('framework edge cases: Vue query error state', () => {
  it('useQuery sets error ref when execute throws', async () => {
    const { createApp, defineComponent, ref: vueRef } = await import('vue');
    const { useQuery } = await import('./vue');

    const db = await GrafeoDB.create();
    vi.spyOn(db, 'execute').mockRejectedValue(new Error('broken query'));

    const dbRef = vueRef(db) as import('vue').Ref<GrafeoDBInstance | null>;

    let result: ReturnType<typeof useQuery>;
    const app = createApp(
      defineComponent({
        setup() {
          result = useQuery(dbRef, 'BAD QUERY');
          return () => null;
        },
      }),
    );
    const root = document.createElement('div');
    app.mount(root);

    await vi.waitFor(() => {
      expect(result!.loading.value).toBe(false);
    });

    expect(result!.error.value).toBeInstanceOf(Error);
    expect(result!.error.value!.message).toBe('broken query');

    app.unmount();
    await db.close();
  });
});

describe('framework edge cases: React query error state', () => {
  it('useQuery sets error when execute throws', async () => {
    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { act } = React;
    const { useQuery } = await import('./react');

    const db = await GrafeoDB.create();
    vi.spyOn(db, 'execute').mockRejectedValue(new Error('react query fail'));

    const resultRef = { current: null as ReturnType<typeof useQuery> | null };

    const TestComponent: React.FC = () => {
      resultRef.current = useQuery(db, 'BAD QUERY');
      return null;
    };

    const container = document.createElement('div');
    document.body.appendChild(container);

    let root: ReturnType<typeof createRoot>;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(TestComponent));
    });

    await vi.waitFor(() => {
      expect(resultRef.current!.loading).toBe(false);
    });

    expect(resultRef.current!.error).toBeInstanceOf(Error);
    expect(resultRef.current!.error!.message).toBe('react query fail');

    act(() => root!.unmount());
    document.body.removeChild(container);
    await db.close();
  });
});

// ---------------------------------------------------------------------------
// 7. Worker communication edge cases
// ---------------------------------------------------------------------------
describe('worker communication edge cases', () => {
  it('send() before init() rejects with clear message', async () => {
    const proxy = new WorkerProxy();
    await expect(proxy.execute('MATCH (n) RETURN n')).rejects.toThrow(
      'Worker not initialized',
    );
  });

  it('worker.onerror rejects all pending promises', async () => {
    const proxy = new WorkerProxy();

    const OriginalWorker = globalThis.Worker;
    // Use function() syntax so vi.fn produces a valid constructor
    globalThis.Worker = vi.fn(function (this: Record<string, unknown>) {
      this.terminate = vi.fn();
      this.addEventListener = vi.fn();
      this.removeEventListener = vi.fn();
      // Respond only to 'init'
      this.postMessage = vi.fn((msg: { id: number; method: string }) => {
        if (msg.method === 'init') {
          const onmessage = this.onmessage as ((e: MessageEvent) => void) | null;
          setTimeout(() => onmessage?.({ data: { id: msg.id, result: true } } as MessageEvent), 0);
        }
      });
    }) as unknown as typeof Worker;

    try {
      await proxy.init();

      // Fire requests that won't get responses
      const p1 = proxy.nodeCount();
      const p2 = proxy.edgeCount();

      // Simulate worker error via onerror
      const worker = (proxy as unknown as { worker: { onerror: ((e: ErrorEvent) => void) | null } }).worker;
      worker.onerror?.({ message: 'Worker crashed' } as ErrorEvent);

      await expect(p1).rejects.toThrow('Worker crashed');
      await expect(p2).rejects.toThrow('Worker crashed');
    } finally {
      globalThis.Worker = OriginalWorker;
    }
  });

  it('close() terminates worker and prevents further calls', async () => {
    const proxy = new WorkerProxy();

    const terminateFn = vi.fn();
    const OriginalWorker = globalThis.Worker;
    globalThis.Worker = vi.fn(function (this: Record<string, unknown>) {
      this.terminate = terminateFn;
      this.postMessage = vi.fn((msg: { id: number; method: string }) => {
        if (msg.method === 'init' || msg.method === 'close') {
          const onmessage = this.onmessage as ((e: MessageEvent) => void) | null;
          setTimeout(() => onmessage?.({ data: { id: msg.id, result: true } } as MessageEvent), 0);
        }
      });
    }) as unknown as typeof Worker;

    try {
      await proxy.init();
      await proxy.close();
      expect(terminateFn).toHaveBeenCalled();

      // After close, further calls should fail
      await expect(proxy.execute('MATCH (n) RETURN n')).rejects.toThrow(
        'Worker not initialized',
      );
    } finally {
      globalThis.Worker = OriginalWorker;
    }
  });
});

// ---------------------------------------------------------------------------
// 8. State consistency
// ---------------------------------------------------------------------------
describe('state consistency', () => {
  it('schema reflects mutations accurately', async () => {
    const db = await GrafeoDB.create();

    let schema = await db.schema();
    expect(schema.labels).toEqual([]);

    await db.execute("INSERT (:Person {name: 'Alice', age: 30})");
    schema = await db.schema();
    const labelNames = schema.labels.map((l: { name: string }) => l.name);
    expect(labelNames).toContain('Person');

    await db.execute("INSERT (:Company {name: 'Acme'})");
    schema = await db.schema();
    const allLabels = schema.labels.map((l: { name: string }) => l.name);
    expect(allLabels).toContain('Person');
    expect(allLabels).toContain('Company');

    await db.close();
  });

  it('projections are transient and cleared on db.clear()', async () => {
    const db = await GrafeoDB.create();

    expect(await db.createProjection('p1', ['Person'])).toBe(true);
    expect(await db.createProjection('p1', ['Person'])).toBe(false);
    expect(await db.listProjections()).toEqual(['p1']);

    await db.clear();
    expect(await db.listProjections()).toEqual([]);

    await db.close();
  });

  it('schema context persists across queries', async () => {
    const db = await GrafeoDB.create();

    expect(await db.currentSchema()).toBeUndefined();

    await db.setSchema('test_schema');
    expect(await db.currentSchema()).toBe('test_schema');

    await db.execute("INSERT (:Person {name: 'Alice'})");
    expect(await db.currentSchema()).toBe('test_schema');

    await db.resetSchema();
    expect(await db.currentSchema()).toBeUndefined();

    await db.close();
  });

  it('nodeCount and edgeCount are always consistent', async () => {
    const db = await GrafeoDB.create();
    expect(await db.nodeCount()).toBe(0);
    expect(await db.edgeCount()).toBe(0);

    await db.execute("INSERT (:Person {name: 'Alice'})");
    expect(await db.nodeCount()).toBe(1);
    expect(await db.edgeCount()).toBe(0);

    await db.execute("INSERT (:Person {name: 'Bob'})");
    expect(await db.nodeCount()).toBe(2);

    await db.execute(
      "INSERT (:Person {name: 'Carol'})-[:KNOWS]->(:Person {name: 'Dave'})",
    );
    expect(await db.nodeCount()).toBe(4);
    expect(await db.edgeCount()).toBe(1);

    await db.close();
  });

  it('storageStats returns zeros for non-persistent db', async () => {
    const db = await GrafeoDB.create();
    const stats = await db.storageStats();
    expect(stats).toEqual({ bytesUsed: 0, quota: 0 });
    await db.close();
  });
});
