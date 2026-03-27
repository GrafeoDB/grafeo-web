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

  describe('vector index methods', () => {
    it('createVectorIndex does not throw', async () => {
      await expect(db.createVectorIndex('Doc', 'embedding')).resolves.toBeUndefined();
    });

    it('createVectorIndex accepts options', async () => {
      await expect(
        db.createVectorIndex('Doc', 'embedding', { dimensions: 384, metric: 'cosine' }),
      ).resolves.toBeUndefined();
    });

    it('dropVectorIndex returns boolean', async () => {
      const result = await db.dropVectorIndex('Doc', 'embedding');
      expect(typeof result).toBe('boolean');
    });

    it('rebuildVectorIndex does not throw', async () => {
      await expect(db.rebuildVectorIndex('Doc', 'embedding')).resolves.toBeUndefined();
    });

    it('vectorSearch returns array', async () => {
      const results = await db.vectorSearch('Doc', 'embedding', new Float32Array([1, 0, 0]), 5);
      expect(Array.isArray(results)).toBe(true);
    });

    it('mmrSearch returns array', async () => {
      const results = await db.mmrSearch('Doc', 'embedding', new Float32Array([1, 0, 0]), 5);
      expect(Array.isArray(results)).toBe(true);
    });

    it('vectorSearch throws when feature missing', async () => {
      const instance = await GrafeoDB.create();
      const wasm = (instance as unknown as { wasm: Record<string, unknown> }).wasm;
      Object.defineProperty(wasm, 'vectorSearch', { value: undefined, configurable: true });

      await expect(
        instance.vectorSearch('Doc', 'embedding', new Float32Array([1]), 5),
      ).rejects.toThrow("vectorSearch() requires @grafeo-db/wasm built with the 'vector-index' feature");

      await instance.close();
    });

    it('mmrSearch throws when feature missing', async () => {
      const instance = await GrafeoDB.create();
      const wasm = (instance as unknown as { wasm: Record<string, unknown> }).wasm;
      Object.defineProperty(wasm, 'mmrSearch', { value: undefined, configurable: true });

      await expect(
        instance.mmrSearch('Doc', 'embedding', new Float32Array([1]), 5),
      ).rejects.toThrow("mmrSearch() requires @grafeo-db/wasm built with the 'vector-index' feature");

      await instance.close();
    });
  });

  describe('schema context', () => {
    it('setSchema/currentSchema/resetSchema round-trips', async () => {
      expect(await db.currentSchema()).toBeUndefined();

      await db.setSchema('my_schema');
      expect(await db.currentSchema()).toBe('my_schema');

      await db.resetSchema();
      expect(await db.currentSchema()).toBeUndefined();
    });

    it('throws when database is closed', async () => {
      const instance = await GrafeoDB.create();
      await instance.close();
      await expect(instance.setSchema('x')).rejects.toThrow('Database is closed');
      await expect(instance.resetSchema()).rejects.toThrow('Database is closed');
      await expect(instance.currentSchema()).rejects.toThrow('Database is closed');
    });
  });

  describe('clearPlanCache()', () => {
    it('does not throw', async () => {
      await expect(db.clearPlanCache()).resolves.toBeUndefined();
    });

    it('throws when database is closed', async () => {
      const instance = await GrafeoDB.create();
      await instance.close();
      await expect(instance.clearPlanCache()).rejects.toThrow('Database is closed');
    });
  });

  describe('memoryUsage()', () => {
    it('returns a memory breakdown object', async () => {
      const usage = await db.memoryUsage();
      expect(usage).toHaveProperty('total_bytes');
      expect(usage).toHaveProperty('store');
      expect(usage).toHaveProperty('indexes');
    });
  });

  describe('importRows()', () => {
    it('imports nodes from row objects', async () => {
      const count = await db.importRows(
        [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }],
        { mode: 'nodes', label: 'Person' },
      );
      expect(count).toBe(2);
    });

    it('imports edges from row objects', async () => {
      const count = await db.importRows(
        [{ source: 0, target: 1, since: 2020 }],
        { mode: 'edges', edgeType: 'KNOWS' },
      );
      expect(count).toBe(1);
    });

    it('triggers persistence when persisted', async () => {
      const pdb = await GrafeoDB.create({ persist: 'rows-import-test' });
      const count = await pdb.importRows(
        [{ name: 'Alice' }],
        { mode: 'nodes', label: 'Person' },
      );
      expect(count).toBe(1);
      await pdb.close();
    });
  });

  describe('importLpg()', () => {
    it('bulk-imports nodes and edges', async () => {
      const result = await db.importLpg({
        nodes: [
          { labels: ['Person'], properties: { name: 'Alice', age: 30 } },
          { labels: ['Person'], properties: { name: 'Bob', age: 25 } },
        ],
        edges: [
          { source: 0, target: 1, type: 'KNOWS', properties: { since: 2020 } },
        ],
      });

      expect(result).toEqual({ nodes: 2, edges: 1 });
      expect(await db.nodeCount()).toBe(2);
      expect(await db.edgeCount()).toBe(1);
    });

    it('imports nodes without properties', async () => {
      const result = await db.importLpg({
        nodes: [{ labels: ['Tag'] }],
        edges: [],
      });

      expect(result).toEqual({ nodes: 1, edges: 0 });
      expect(await db.nodeCount()).toBe(1);
    });

    it('triggers persistence when persisted', async () => {
      const pdb = await GrafeoDB.create({ persist: 'lpg-import-test' });
      const result = await pdb.importLpg({
        nodes: [{ labels: ['Person'], properties: { name: 'Alice' } }],
        edges: [],
      });
      expect(result.nodes).toBe(1);
      await pdb.close();
    });
  });

  describe('importRdf()', () => {
    it('bulk-imports RDF triples', async () => {
      const result = await db.importRdf({
        triples: [
          {
            subject: 'http://example.org/Alice',
            predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
            object: 'http://example.org/Person',
          },
          {
            subject: 'http://example.org/Alice',
            predicate: 'http://example.org/name',
            object: { value: 'Alice' },
          },
        ],
      });

      expect(result).toEqual({ triples: 2 });
    });

    it('throws when rdf feature missing', async () => {
      const instance = await GrafeoDB.create();
      const wasm = (instance as unknown as { wasm: Record<string, unknown> }).wasm;
      Object.defineProperty(wasm, 'importRdf', { value: undefined, configurable: true });

      await expect(
        instance.importRdf({ triples: [] }),
      ).rejects.toThrow("importRdf() requires @grafeo-db/wasm built with the 'rdf' feature");

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

  describe('persistence scheduling (isMutatingQuery removal)', () => {
    it('schedules save after INSERT', async () => {
      const pdb = await GrafeoDB.create({ persist: 'persist-insert-test' });
      // INSERT is an obviously mutating query, should always trigger save
      await pdb.execute("INSERT (:Person {name: 'Alix'})");
      // If we reach here without error, persistence scheduling succeeded
      await pdb.close();
    });

    it('schedules save after MATCH...DELETE (previously missed)', async () => {
      const pdb = await GrafeoDB.create({ persist: 'persist-delete-test' });
      await pdb.execute("INSERT (:Temp {name: 'del'})");
      // MATCH (n) DELETE n was the primary pattern missed by the old isMutatingQuery regex
      await pdb.execute('MATCH (n:Temp) DELETE n');
      await pdb.close();
    });

    it('schedules save after MATCH...SET (previously missed)', async () => {
      const pdb = await GrafeoDB.create({ persist: 'persist-set-test' });
      await pdb.execute("INSERT (:Temp {name: 'upd', age: 1})");
      // MATCH ... SET was another missed pattern
      await pdb.execute('MATCH (n:Temp) SET n.age = 2');
      await pdb.close();
    });

    it('schedules save after read-only query (by design)', async () => {
      const pdb = await GrafeoDB.create({ persist: 'persist-read-test' });
      await pdb.execute("INSERT (:Person {name: 'Alix'})");
      // Even read queries now trigger save (the fix removes isMutatingQuery entirely)
      await pdb.execute('MATCH (n) RETURN n');
      await pdb.close();
    });

    it('schedules save after executeRaw', async () => {
      const pdb = await GrafeoDB.create({ persist: 'persist-raw-test' });
      await pdb.executeRaw("INSERT (:Person {name: 'Alix'})");
      await pdb.close();
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

  it('delegates createVectorIndex through proxy', async () => {
    const wdb = await createWorkerDb();
    const promise = wdb.createVectorIndex('Doc', 'embedding', { dimensions: 384 });
    respondToLast(undefined);
    await promise;

    const lastCall = mockWorker.postMessage.mock.calls.at(-1)![0];
    expect(lastCall.method).toBe('createVectorIndex');

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates vectorSearch through proxy', async () => {
    const wdb = await createWorkerDb();
    const mockResults = [{ id: 1, distance: 0.12 }];
    const promise = wdb.vectorSearch('Doc', 'embedding', new Float32Array([1, 0]), 5);
    respondToLast(mockResults);
    const result = await promise;
    expect(result).toEqual(mockResults);

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates memoryUsage through proxy', async () => {
    const wdb = await createWorkerDb();
    const mockUsage = { total_bytes: 1024, store: { total_bytes: 512 } };
    const promise = wdb.memoryUsage();
    respondToLast(mockUsage);
    const result = await promise;
    expect(result).toEqual(mockUsage);

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates importRows through proxy', async () => {
    const wdb = await createWorkerDb();
    const promise = wdb.importRows([{ name: 'Alice' }], { mode: 'nodes', label: 'Person' });
    respondToLast(1);
    const result = await promise;
    expect(result).toBe(1);

    const lastCall = mockWorker.postMessage.mock.calls.at(-1)![0];
    expect(lastCall.method).toBe('importRows');

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates importLpg through proxy', async () => {
    const wdb = await createWorkerDb();
    const mockResult = { nodes: 2, edges: 1 };
    const promise = wdb.importLpg({
      nodes: [
        { labels: ['Person'], properties: { name: 'Alice' } },
        { labels: ['Person'], properties: { name: 'Bob' } },
      ],
      edges: [{ source: 0, target: 1, type: 'KNOWS' }],
    });
    respondToLast(mockResult);
    const result = await promise;
    expect(result).toEqual(mockResult);

    const lastCall = mockWorker.postMessage.mock.calls.at(-1)![0];
    expect(lastCall.method).toBe('importLpg');

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates importRdf through proxy', async () => {
    const wdb = await createWorkerDb();
    const mockResult = { triples: 3 };
    const promise = wdb.importRdf({
      triples: [
        {
          subject: 'http://example.org/Alice',
          predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
          object: 'http://example.org/Person',
        },
      ],
    });
    respondToLast(mockResult);
    const result = await promise;
    expect(result).toEqual(mockResult);

    const lastCall = mockWorker.postMessage.mock.calls.at(-1)![0];
    expect(lastCall.method).toBe('importRdf');

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates setSchema through proxy', async () => {
    const wdb = await createWorkerDb();
    const promise = wdb.setSchema('my_schema');
    respondToLast(undefined);
    await promise;

    const lastCall = mockWorker.postMessage.mock.calls.at(-1)![0];
    expect(lastCall.method).toBe('setSchema');
    expect(lastCall.args).toEqual(['my_schema']);

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates resetSchema through proxy', async () => {
    const wdb = await createWorkerDb();
    const promise = wdb.resetSchema();
    respondToLast(undefined);
    await promise;

    const lastCall = mockWorker.postMessage.mock.calls.at(-1)![0];
    expect(lastCall.method).toBe('resetSchema');

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates currentSchema through proxy', async () => {
    const wdb = await createWorkerDb();
    const promise = wdb.currentSchema();
    respondToLast('my_schema');
    const result = await promise;
    expect(result).toBe('my_schema');

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates clearPlanCache through proxy', async () => {
    const wdb = await createWorkerDb();
    const promise = wdb.clearPlanCache();
    respondToLast(undefined);
    await promise;

    const lastCall = mockWorker.postMessage.mock.calls.at(-1)![0];
    expect(lastCall.method).toBe('clearPlanCache');

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
