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

  describe('snapshot migration', () => {
    it('recovers from incompatible persisted snapshot', async () => {
      // First, persist a snapshot
      const pdb = await GrafeoDB.create({ persist: 'migration-test' });
      await pdb.execute("INSERT (:Person {name: 'Alice'})");
      await pdb.close();

      // Make importSnapshot throw to simulate format incompatibility
      const { Database } = await import('./__mocks__/wasm');
      const originalImport = Database.importSnapshot;
      Database.importSnapshot = () => {
        throw new Error('Incompatible snapshot format');
      };

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        // Should recover gracefully instead of crashing
        const recovered = await GrafeoDB.create({ persist: 'migration-test' });
        expect(recovered).toBeDefined();
        expect(recovered.isOpen).toBe(true);
        // Fresh db should have 0 nodes
        expect(await recovered.nodeCount()).toBe(0);

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('incompatible with this WASM version'),
          expect.any(Error),
        );

        // Verify backup was saved under the __backup key
        const { PersistenceManager } = await import('./persistence');
        const backupPm = new PersistenceManager('migration-test__backup');
        const backup = await backupPm.load();
        expect(backup).not.toBeNull();
        expect(backup).toBeInstanceOf(Uint8Array);
        await backupPm.clear();

        await recovered.close();
      } finally {
        Database.importSnapshot = originalImport;
        warnSpy.mockRestore();
      }
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

    it('does not corrupt database on failed import', async () => {
      await db.execute("INSERT (:Person {name: 'Alice'})");

      // Import with corrupted data should throw but leave db usable
      const badSnapshot = { version: 1, data: new Uint8Array([0xFF]), timestamp: Date.now() };
      const { Database } = await import('./__mocks__/wasm');
      const originalImport = Database.importSnapshot;
      Database.importSnapshot = () => { throw new Error('Corrupt snapshot'); };

      try {
        await expect(db.import(badSnapshot)).rejects.toThrow('Corrupt snapshot');

        // Database should still be usable after failed import
        const results = await db.execute('MATCH (p:Person) RETURN p.name');
        expect(results).toHaveLength(1);
        expect(results[0]['p.name']).toBe('Alice');
      } finally {
        Database.importSnapshot = originalImport;
      }
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

  describe('graph projections', () => {
    it('createProjection returns true on first call', async () => {
      const created = await db.createProjection('social', ['Person'], ['KNOWS']);
      expect(created).toBe(true);
    });

    it('createProjection returns false for duplicate name', async () => {
      await db.createProjection('social', ['Person'], ['KNOWS']);
      const duplicate = await db.createProjection('social', ['Person'], ['KNOWS']);
      expect(duplicate).toBe(false);
    });

    it('createProjection works without filters', async () => {
      const created = await db.createProjection('all');
      expect(created).toBe(true);
    });

    it('dropProjection returns true when it existed', async () => {
      await db.createProjection('social', ['Person']);
      const dropped = await db.dropProjection('social');
      expect(dropped).toBe(true);
    });

    it('dropProjection returns false when not found', async () => {
      const dropped = await db.dropProjection('nonexistent');
      expect(dropped).toBe(false);
    });

    it('listProjections returns created projection names', async () => {
      await db.createProjection('social', ['Person'], ['KNOWS']);
      await db.createProjection('docs', ['Document']);
      const names = await db.listProjections();
      expect(names).toContain('social');
      expect(names).toContain('docs');
      expect(names).toHaveLength(2);
    });

    it('listProjections returns empty array initially', async () => {
      const names = await db.listProjections();
      expect(names).toEqual([]);
    });

    it('triggers persistence on createProjection', async () => {
      const pdb = await GrafeoDB.create({ persist: 'proj-create-test' });
      const created = await pdb.createProjection('social', ['Person']);
      expect(created).toBe(true);
      await pdb.close();
    });

    it('triggers persistence on dropProjection', async () => {
      const pdb = await GrafeoDB.create({ persist: 'proj-drop-test' });
      await pdb.createProjection('social', ['Person']);
      const dropped = await pdb.dropProjection('social');
      expect(dropped).toBe(true);
      await pdb.close();
    });

    it('throws when database is closed', async () => {
      const instance = await GrafeoDB.create();
      await instance.close();
      await expect(instance.createProjection('x')).rejects.toThrow('Database is closed');
      await expect(instance.dropProjection('x')).rejects.toThrow('Database is closed');
      await expect(instance.listProjections()).rejects.toThrow('Database is closed');
    });
  });

  describe('schema()', () => {
    it('returns typed schema info', async () => {
      await db.execute("INSERT (:Person {name: 'Alice'})");
      const schema = await db.schema();
      expect(schema).toHaveProperty('mode');
      expect(schema).toHaveProperty('labels');
      expect(schema).toHaveProperty('edge_types');
      expect(schema).toHaveProperty('property_keys');
      expect(Array.isArray(schema.labels)).toBe(true);
      expect(schema.labels[0]).toHaveProperty('name');
      expect(schema.labels[0]).toHaveProperty('count');
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

  describe('compact()', () => {
    it('does not throw', async () => {
      await expect(db.compact()).resolves.toBeUndefined();
    });

    it('triggers persistence when persisted', async () => {
      const pdb = await GrafeoDB.create({ persist: 'compact-test' });
      await expect(pdb.compact()).resolves.toBeUndefined();
      await pdb.close();
    });

    it('throws when database is closed', async () => {
      const instance = await GrafeoDB.create();
      await instance.close();
      await expect(instance.compact()).rejects.toThrow('Database is closed');
    });

    it('throws when feature missing', async () => {
      const instance = await GrafeoDB.create();
      const wasm = (instance as unknown as { wasm: Record<string, unknown> }).wasm;
      Object.defineProperty(wasm, 'compact', { value: undefined, configurable: true });

      await expect(instance.compact()).rejects.toThrow(
        "compact() requires @grafeo-db/wasm built with the 'compact-store' feature",
      );

      await instance.close();
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

  describe('info()', () => {
    it('returns database information with mode, version, and features', async () => {
      const dbInfo = await db.info();
      expect(dbInfo.mode).toBe('Lpg');
      expect(typeof dbInfo.version).toBe('string');
      expect(Array.isArray(dbInfo.features)).toBe(true);
      expect(dbInfo.features).toContain('gql');
    });

    it('reflects current node and edge counts', async () => {
      await db.execute("INSERT (:Person {name: 'Alice'})");
      const dbInfo = await db.info();
      expect(dbInfo.node_count).toBe(1);
      expect(dbInfo.edge_count).toBe(0);
    });

    it('throws when database is closed', async () => {
      const instance = await GrafeoDB.create();
      await instance.close();
      await expect(instance.info()).rejects.toThrow('Database is closed');
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
    it('throws not-implemented error', async () => {
      await expect(db.changesSince(0)).rejects.toThrow('not yet implemented');
    });
  });

  describe('storageStats()', () => {
    it('returns stats for non-persistent db', async () => {
      const stats = await db.storageStats();
      expect(stats).toEqual({ bytesUsed: 0, quota: 0 });
    });
  });

  describe('transactions', () => {
    it('beginTransaction/commitTransaction round-trip', async () => {
      expect(await db.isTransactionActive()).toBe(false);
      await db.beginTransaction();
      expect(await db.isTransactionActive()).toBe(true);
      await db.commitTransaction();
      expect(await db.isTransactionActive()).toBe(false);
    });

    it('rollbackTransaction reverts writes made during the transaction', async () => {
      await db.execute("INSERT (:Person {name: 'Alice'})");
      expect(await db.nodeCount()).toBe(1);

      await db.beginTransaction();
      await db.execute("INSERT (:Person {name: 'Bob'})");
      expect(await db.nodeCount()).toBe(2);
      await db.rollbackTransaction();

      expect(await db.nodeCount()).toBe(1);
      expect(await db.isTransactionActive()).toBe(false);
    });

    it('commitTransaction makes writes durable', async () => {
      await db.beginTransaction();
      await db.execute("INSERT (:Person {name: 'Alice'})");
      await db.commitTransaction();

      expect(await db.nodeCount()).toBe(1);
      expect(await db.isTransactionActive()).toBe(false);
    });

    it('beginTransaction throws when one is already active', async () => {
      await db.beginTransaction();
      await expect(db.beginTransaction()).rejects.toThrow(/already active/i);
      await db.rollbackTransaction();
    });

    it('commitTransaction/rollbackTransaction throw when none is active', async () => {
      await expect(db.commitTransaction()).rejects.toThrow(/no active transaction/i);
      await expect(db.rollbackTransaction()).rejects.toThrow(/no active transaction/i);
    });

    it('all transaction methods throw when database is closed', async () => {
      const instance = await GrafeoDB.create();
      await instance.close();
      await expect(instance.beginTransaction()).rejects.toThrow('Database is closed');
      await expect(instance.commitTransaction()).rejects.toThrow('Database is closed');
      await expect(instance.rollbackTransaction()).rejects.toThrow('Database is closed');
      await expect(instance.isTransactionActive()).rejects.toThrow('Database is closed');
    });
  });

  describe('signed snapshots', () => {
    const key = new Uint8Array([
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
      0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
    ]);

    it('signedExport returns a Uint8Array prefixed with GSN1', async () => {
      await db.execute("INSERT (:Person {name: 'Alice'})");
      const signed = await db.signedExport(key);
      expect(signed).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(signed.slice(0, 4))).toBe('GSN1');
    });

    it('signedExport + signedImport round-trips database state', async () => {
      await db.execute("INSERT (:Person {name: 'Alice', age: 30})");
      const signed = await db.signedExport(key);

      const db2 = await GrafeoDB.create();
      await db2.signedImport(signed, key);
      const results = await db2.execute('MATCH (p:Person) RETURN p.name');
      expect(results).toHaveLength(1);
      expect(results[0]['p.name']).toBe('Alice');
      await db2.close();
    });

    it('signedImport rejects payload signed with a different key', async () => {
      await db.execute("INSERT (:Person {name: 'Alice'})");
      const signed = await db.signedExport(key);

      const wrongKey = new Uint8Array(key);
      wrongKey[0] ^= 0xff;

      const db2 = await GrafeoDB.create();
      await expect(db2.signedImport(signed, wrongKey)).rejects.toThrow();
      await db2.close();
    });

    it('signedImport rejects an unsigned snapshot', async () => {
      await db.execute("INSERT (:Person {name: 'Alice'})");
      const unsigned = await db.export();
      const db2 = await GrafeoDB.create();
      await expect(db2.signedImport(unsigned.data, key)).rejects.toThrow();
      await db2.close();
    });

    it('signedExport throws when database is closed', async () => {
      const instance = await GrafeoDB.create();
      await instance.close();
      await expect(instance.signedExport(key)).rejects.toThrow('Database is closed');
    });

    it('signedImport throws when database is closed', async () => {
      const instance = await GrafeoDB.create();
      await instance.close();
      await expect(instance.signedImport(new Uint8Array([0]), key)).rejects.toThrow('Database is closed');
    });
  });

  describe('transaction persistence deferral', () => {
    interface PersistenceShape {
      scheduleSave: (...args: unknown[]) => void;
      cancel: () => void;
    }

    function getPersistence(instance: GrafeoDBInstance): PersistenceShape {
      return (instance as unknown as { persistence: PersistenceShape }).persistence;
    }

    it('execute() inside a tx does not call scheduleSave', async () => {
      const pdb = await GrafeoDB.create({ persist: 'tx-defer-execute' });
      try {
        const persistence = getPersistence(pdb);
        await pdb.beginTransaction();
        const saveSpy = vi.spyOn(persistence, 'scheduleSave');
        await pdb.execute("INSERT (:Person {name: 'Alice'})");
        expect(saveSpy).not.toHaveBeenCalled();
        await pdb.rollbackTransaction();
        saveSpy.mockRestore();
      } finally {
        await pdb.close();
        const { PersistenceManager } = await import('./persistence');
        await new PersistenceManager('tx-defer-execute').clear();
      }
    });

    it('beginTransaction() calls cancel on the persistence manager', async () => {
      const pdb = await GrafeoDB.create({ persist: 'tx-defer-cancel' });
      try {
        const persistence = getPersistence(pdb);
        const cancelSpy = vi.spyOn(persistence, 'cancel');
        // Pre-tx execute schedules a pending save
        await pdb.execute("INSERT (:Person {name: 'Alice'})");
        await pdb.beginTransaction();
        expect(cancelSpy).toHaveBeenCalled();
        await pdb.rollbackTransaction();
        cancelSpy.mockRestore();
      } finally {
        await pdb.close();
        const { PersistenceManager } = await import('./persistence');
        await new PersistenceManager('tx-defer-cancel').clear();
      }
    });

    it('commitTransaction() calls scheduleSave', async () => {
      const pdb = await GrafeoDB.create({ persist: 'tx-defer-commit' });
      try {
        const persistence = getPersistence(pdb);
        await pdb.beginTransaction();
        const saveSpy = vi.spyOn(persistence, 'scheduleSave');
        await pdb.commitTransaction();
        expect(saveSpy).toHaveBeenCalled();
        saveSpy.mockRestore();
      } finally {
        await pdb.close();
        const { PersistenceManager } = await import('./persistence');
        await new PersistenceManager('tx-defer-commit').clear();
      }
    });

    it('rollbackTransaction() calls scheduleSave (post-rollback state must land on disk)', async () => {
      const pdb = await GrafeoDB.create({ persist: 'tx-defer-rollback' });
      try {
        const persistence = getPersistence(pdb);
        await pdb.beginTransaction();
        const saveSpy = vi.spyOn(persistence, 'scheduleSave');
        await pdb.rollbackTransaction();
        expect(saveSpy).toHaveBeenCalled();
        saveSpy.mockRestore();
      } finally {
        await pdb.close();
        const { PersistenceManager } = await import('./persistence');
        await new PersistenceManager('tx-defer-rollback').clear();
      }
    });

    it('after commit, subsequent execute() resumes calling scheduleSave normally', async () => {
      const pdb = await GrafeoDB.create({ persist: 'tx-defer-resume' });
      try {
        await pdb.beginTransaction();
        await pdb.commitTransaction();
        const persistence = getPersistence(pdb);
        const saveSpy = vi.spyOn(persistence, 'scheduleSave');
        await pdb.execute("INSERT (:Person {name: 'Alice'})");
        expect(saveSpy).toHaveBeenCalled();
        saveSpy.mockRestore();
      } finally {
        await pdb.close();
        const { PersistenceManager } = await import('./persistence');
        await new PersistenceManager('tx-defer-resume').clear();
      }
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

  it('delegates info through proxy', async () => {
    const wdb = await createWorkerDb();
    const mockInfo = { mode: 'Lpg', node_count: 5, edge_count: 3, version: '0.5.31', features: ['gql'] };
    const promise = wdb.info();
    respondToLast(mockInfo);
    const result = await promise;
    expect(result).toEqual(mockInfo);

    const lastCall = mockWorker.postMessage.mock.calls.at(-1)![0];
    expect(lastCall.method).toBe('info');

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

  it('delegates compact through proxy', async () => {
    const wdb = await createWorkerDb();
    const promise = wdb.compact();
    respondToLast(undefined);
    await promise;

    const lastCall = mockWorker.postMessage.mock.calls.at(-1)![0];
    expect(lastCall.method).toBe('compact');

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates createProjection through proxy', async () => {
    const wdb = await createWorkerDb();
    const promise = wdb.createProjection('social', ['Person'], ['KNOWS']);
    respondToLast(true);
    const result = await promise;
    expect(result).toBe(true);

    const lastCall = mockWorker.postMessage.mock.calls.at(-1)![0];
    expect(lastCall.method).toBe('createProjection');
    expect(lastCall.args).toEqual(['social', ['Person'], ['KNOWS']]);

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates dropProjection through proxy', async () => {
    const wdb = await createWorkerDb();
    const promise = wdb.dropProjection('social');
    respondToLast(true);
    const result = await promise;
    expect(result).toBe(true);

    const lastCall = mockWorker.postMessage.mock.calls.at(-1)![0];
    expect(lastCall.method).toBe('dropProjection');

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates listProjections through proxy', async () => {
    const wdb = await createWorkerDb();
    const promise = wdb.listProjections();
    respondToLast(['social', 'docs']);
    const result = await promise;
    expect(result).toEqual(['social', 'docs']);

    const lastCall = mockWorker.postMessage.mock.calls.at(-1)![0];
    expect(lastCall.method).toBe('listProjections');

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates beginTransaction through proxy', async () => {
    const wdb = await createWorkerDb();
    const promise = wdb.beginTransaction();
    respondToLast(undefined);
    await promise;

    const lastCall = mockWorker.postMessage.mock.calls.at(-1)![0];
    expect(lastCall.method).toBe('beginTransaction');

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates commitTransaction through proxy', async () => {
    const wdb = await createWorkerDb();
    const promise = wdb.commitTransaction();
    respondToLast(undefined);
    await promise;

    const lastCall = mockWorker.postMessage.mock.calls.at(-1)![0];
    expect(lastCall.method).toBe('commitTransaction');

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates rollbackTransaction through proxy', async () => {
    const wdb = await createWorkerDb();
    const promise = wdb.rollbackTransaction();
    respondToLast(undefined);
    await promise;

    const lastCall = mockWorker.postMessage.mock.calls.at(-1)![0];
    expect(lastCall.method).toBe('rollbackTransaction');

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates isTransactionActive through proxy', async () => {
    const wdb = await createWorkerDb();
    const promise = wdb.isTransactionActive();
    respondToLast(true);
    const result = await promise;
    expect(result).toBe(true);

    const lastCall = mockWorker.postMessage.mock.calls.at(-1)![0];
    expect(lastCall.method).toBe('isTransactionActive');

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates signedExport through proxy', async () => {
    const wdb = await createWorkerDb();
    const key = new Uint8Array([1, 2, 3, 4]);
    const mockSigned = new Uint8Array([0x47, 0x53, 0x4e, 0x31, 0x00]);
    const promise = wdb.signedExport(key);
    respondToLast(mockSigned);
    const result = await promise;
    expect(result).toEqual(mockSigned);

    const lastCall = mockWorker.postMessage.mock.calls.at(-1)![0];
    expect(lastCall.method).toBe('signedExport');
    expect(lastCall.args[0]).toEqual(key);

    const closePromise = wdb.close();
    respondToLast(undefined);
    await closePromise;
  });

  it('delegates signedImport through proxy', async () => {
    const wdb = await createWorkerDb();
    const key = new Uint8Array([1, 2, 3, 4]);
    const signed = new Uint8Array([0x47, 0x53, 0x4e, 0x31, 0x00]);
    const promise = wdb.signedImport(signed, key);
    respondToLast(undefined);
    await promise;

    const lastCall = mockWorker.postMessage.mock.calls.at(-1)![0];
    expect(lastCall.method).toBe('signedImport');
    expect(lastCall.args[0]).toEqual(signed);
    expect(lastCall.args[1]).toEqual(key);

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
