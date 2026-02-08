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
