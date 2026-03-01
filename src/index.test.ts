import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the WASM module before importing GrafeoDB
vi.mock('@grafeo-db/wasm', () => import('./__mocks__/wasm'));

const { GrafeoDB } = await import('./index');
type GrafeoDBInstance = Awaited<ReturnType<typeof GrafeoDB.create>>;

describe('GrafeoDB', () => {
  let db: GrafeoDBInstance;

  beforeEach(async () => {
    db = await GrafeoDB.create();
  });

  afterEach(async () => {
    await db.close();
  });

  describe('version()', () => {
    it('returns the WASM engine version', () => {
      expect(typeof GrafeoDB.version()).toBe('string');
    });
  });

  describe('create()', () => {
    it('creates an in-memory database', async () => {
      const instance = await GrafeoDB.create();
      expect(instance).toBeDefined();
      await instance.close();
    });

    it('creates a database with persistence option', async () => {
      const instance = await GrafeoDB.create({ persist: 'test-db' });
      expect(instance).toBeDefined();
      await instance.close();
    });
  });

  describe('execute()', () => {
    it('inserts and queries nodes', async () => {
      await db.execute("INSERT (:Person {name: 'Alice', age: 30})");
      const results = await db.execute(
        'MATCH (p:Person) RETURN p.name, p.age',
      );

      expect(results).toHaveLength(1);
      expect(results[0]['p.name']).toBe('Alice');
      expect(results[0]['p.age']).toBe(30);
    });

    it('returns empty array for no matches', async () => {
      const results = await db.execute(
        'MATCH (p:Person) RETURN p.name',
      );
      expect(results).toEqual([]);
    });

    it('inserts multiple nodes', async () => {
      await db.execute("INSERT (:Person {name: 'Alice', age: 30})");
      await db.execute("INSERT (:Person {name: 'Bob', age: 25})");

      const results = await db.execute(
        'MATCH (p:Person) RETURN p.name',
      );
      expect(results).toHaveLength(2);
    });

    it('throws on invalid query', async () => {
      await expect(db.execute('INVALID QUERY')).rejects.toThrow();
    });
  });

  describe('executeRaw()', () => {
    it('returns columns and rows', async () => {
      await db.execute("INSERT (:Person {name: 'Alice'})");
      const result = await db.executeRaw(
        'MATCH (p:Person) RETURN p.name',
      );

      expect(result.columns).toContain('p.name');
      expect(result.rows).toHaveLength(1);
      expect(result.executionTimeMs).toBeDefined();
    });
  });

  describe('nodeCount() / edgeCount()', () => {
    it('tracks node and edge counts', async () => {
      expect(await db.nodeCount()).toBe(0);
      expect(await db.edgeCount()).toBe(0);

      await db.execute("INSERT (:Person {name: 'Alice'})");
      expect(await db.nodeCount()).toBe(1);

      await db.execute(
        "INSERT (:Person {name: 'Bob'})-[:KNOWS]->(:Person {name: 'Charlie'})",
      );
      expect(await db.nodeCount()).toBe(3);
      expect(await db.edgeCount()).toBe(1);
    });
  });

  describe('export() / import()', () => {
    it('exports and imports database state', async () => {
      await db.execute("INSERT (:Person {name: 'Alice', age: 30})");
      const snapshot = await db.export();

      expect(snapshot.version).toBe(1);
      expect(snapshot.data).toBeInstanceOf(Uint8Array);
      expect(snapshot.timestamp).toBeLessThanOrEqual(Date.now());

      // Create a fresh database and import
      const db2 = await GrafeoDB.create();
      await db2.import(snapshot);

      const results = await db2.execute(
        'MATCH (p:Person) RETURN p.name',
      );
      expect(results).toHaveLength(1);
      expect(results[0]['p.name']).toBe('Alice');
      await db2.close();
    });
  });

  describe('clear()', () => {
    it('removes all data', async () => {
      await db.execute("INSERT (:Person {name: 'Alice'})");
      expect(await db.nodeCount()).toBe(1);

      await db.clear();
      expect(await db.nodeCount()).toBe(0);
    });
  });

  describe('close()', () => {
    it('is idempotent', async () => {
      const instance = await GrafeoDB.create();
      await instance.close();
      await instance.close(); // should not throw
    });

    it('prevents further operations', async () => {
      const instance = await GrafeoDB.create();
      await instance.close();

      await expect(
        instance.execute('MATCH (n) RETURN n'),
      ).rejects.toThrow('Database is closed');
    });
  });

  describe('execute() with params', () => {
    it('passes params through to WASM executeWithParams', async () => {
      await db.execute("INSERT (:Person {name: 'Alice', age: 30})");
      const results = await db.execute(
        'MATCH (p:Person) RETURN p.name, p.age',
        { params: { name: 'Alice' } },
      );
      expect(results).toHaveLength(1);
    });

    it('passes language + params to executeWithLanguageAndParams', async () => {
      await db.execute("INSERT (:Person {name: 'Bob'})");
      const results = await db.execute(
        'MATCH (p:Person) RETURN p.name',
        { language: 'cypher', params: { name: 'Bob' } },
      );
      expect(results).toHaveLength(1);
    });

    it('supports sql language', async () => {
      await db.execute("INSERT (:Person {name: 'Alice'})");
      const results = await db.execute(
        'MATCH (p:Person) RETURN p.name',
        { language: 'sql' },
      );
      expect(results).toHaveLength(1);
    });
  });

  describe('executeRaw() with language', () => {
    it('dispatches to executeRawWithLanguage', async () => {
      await db.execute("INSERT (:Person {name: 'Alice'})");
      const result = await db.executeRaw(
        'MATCH (p:Person) RETURN p.name',
        { language: 'cypher' },
      );
      expect(result.columns).toContain('p.name');
      expect(result.rows).toHaveLength(1);
    });
  });

  describe('text search', () => {
    it('createTextIndex does not throw', async () => {
      await expect(db.createTextIndex('Person', 'name')).resolves.toBeUndefined();
    });

    it('dropTextIndex returns boolean', async () => {
      const result = await db.dropTextIndex('Person', 'name');
      expect(typeof result).toBe('boolean');
    });

    it('rebuildTextIndex does not throw', async () => {
      await expect(db.rebuildTextIndex('Person', 'name')).resolves.toBeUndefined();
    });

    it('textSearch returns array', async () => {
      const results = await db.textSearch('Person', 'name', 'Alice', 5);
      expect(Array.isArray(results)).toBe(true);
    });

    it('hybridSearch returns array', async () => {
      const results = await db.hybridSearch('Person', 'name', 'embedding', 'Alice', 5);
      expect(Array.isArray(results)).toBe(true);
    });

    it('createTextIndex triggers persistence when persisted', async () => {
      const pdb = await GrafeoDB.create({ persist: 'text-idx-test' });
      await expect(pdb.createTextIndex('Person', 'name')).resolves.toBeUndefined();
      await pdb.close();
    });

    it('dropTextIndex triggers persistence when persisted', async () => {
      const pdb = await GrafeoDB.create({ persist: 'text-idx-test2' });
      const result = await pdb.dropTextIndex('Person', 'name');
      expect(typeof result).toBe('boolean');
      await pdb.close();
    });

    it('rebuildTextIndex triggers persistence when persisted', async () => {
      const pdb = await GrafeoDB.create({ persist: 'text-idx-test3' });
      await expect(pdb.rebuildTextIndex('Person', 'name')).resolves.toBeUndefined();
      await pdb.close();
    });

    it('textSearch throws when feature missing', async () => {
      const instance = await GrafeoDB.create();
      // Override with a non-function to simulate WASM built without text-index
      const wasm = (instance as unknown as { wasm: Record<string, unknown> }).wasm;
      Object.defineProperty(wasm, 'textSearch', { value: undefined, configurable: true });

      await expect(
        instance.textSearch('Person', 'name', 'Alice', 5),
      ).rejects.toThrow("textSearch() requires @grafeo-db/wasm built with the 'text-index' feature");

      await instance.close();
    });

    it('hybridSearch throws when feature missing', async () => {
      const instance = await GrafeoDB.create();
      const wasm = (instance as unknown as { wasm: Record<string, unknown> }).wasm;
      Object.defineProperty(wasm, 'hybridSearch', { value: undefined, configurable: true });

      await expect(
        instance.hybridSearch('Person', 'name', 'embedding', 'Alice', 5),
      ).rejects.toThrow("hybridSearch() requires @grafeo-db/wasm built with the 'hybrid-search' feature");

      await instance.close();
    });
  });

  describe('changesSince()', () => {
    it('returns empty array (not yet implemented)', async () => {
      const changes = await db.changesSince(0);
      expect(changes).toEqual([]);
    });
  });

  describe('storageStats()', () => {
    it('returns stats for non-persistent db', async () => {
      const stats = await db.storageStats();
      expect(stats).toEqual({ bytesUsed: 0, quota: 0 });
    });
  });
});

// Worker-mode tests for proxy delegation branches
describe('GrafeoDB (worker mode)', () => {
  interface MockWorkerInstance {
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
  }

  let mockWorker: MockWorkerInstance;

  beforeEach(() => {
    vi.stubGlobal(
      'Worker',
      vi.fn(function () {
        mockWorker = {
          postMessage: vi.fn(),
          terminate: vi.fn(),
          onmessage: null,
          onerror: null,
        };
        return mockWorker;
      }),
    );
  });

  function respondToLast(result?: unknown, error?: string): void {
    const calls = mockWorker.postMessage.mock.calls;
    const lastMsg = calls[calls.length - 1][0] as { id: number };
    const response = { id: lastMsg.id, result, error };
    mockWorker.onmessage?.({ data: response } as MessageEvent);
  }

  async function createWorkerDb(): Promise<Awaited<ReturnType<typeof GrafeoDB.create>>> {
    const initPromise = GrafeoDB.create({ worker: true });
    respondToLast(true);
    return initPromise;
  }

  it('delegates createTextIndex through proxy', async () => {
    const wdb = await createWorkerDb();
    const promise = wdb.createTextIndex('Person', 'name');
    respondToLast(undefined);
    await promise;

    const lastCall = mockWorker.postMessage.mock.calls.at(-1)![0];
    expect(lastCall.method).toBe('createTextIndex');

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates dropTextIndex through proxy', async () => {
    const wdb = await createWorkerDb();
    const promise = wdb.dropTextIndex('Person', 'name');
    respondToLast(true);
    const result = await promise;
    expect(result).toBe(true);

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates rebuildTextIndex through proxy', async () => {
    const wdb = await createWorkerDb();
    const promise = wdb.rebuildTextIndex('Person', 'name');
    respondToLast(undefined);
    await promise;

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates textSearch through proxy', async () => {
    const wdb = await createWorkerDb();
    const mockResults = [{ id: 1, score: 0.9 }];
    const promise = wdb.textSearch('Person', 'name', 'Alice', 5);
    respondToLast(mockResults);
    const result = await promise;
    expect(result).toEqual(mockResults);

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates hybridSearch through proxy', async () => {
    const wdb = await createWorkerDb();
    const mockResults = [{ id: 2, score: 0.8 }];
    const promise = wdb.hybridSearch('Person', 'name', 'vec', 'Alice', 5);
    respondToLast(mockResults);
    const result = await promise;
    expect(result).toEqual(mockResults);

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });
});
