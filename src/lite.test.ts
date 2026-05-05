import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the WASM lite module before importing GrafeoDB
vi.mock('@grafeo-db/wasm-lite', () => import('./__mocks__/wasm'));

const { GrafeoDB } = await import('./lite');
type GrafeoDBInstance = Awaited<ReturnType<typeof GrafeoDB.create>>;

describe('GrafeoDB (lite)', () => {
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
  });

  describe('snapshot migration', () => {
    it('recovers from incompatible persisted snapshot', async () => {
      // First, persist a snapshot
      const pdb = await GrafeoDB.create({ persist: 'lite-migration-test' });
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
        const recovered = await GrafeoDB.create({ persist: 'lite-migration-test' });
        expect(recovered).toBeDefined();
        expect(recovered.isOpen).toBe(true);
        expect(await recovered.nodeCount()).toBe(0);

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('incompatible with this WASM version'),
          expect.any(Error),
        );

        await recovered.close();
      } finally {
        Database.importSnapshot = originalImport;
        warnSpy.mockRestore();
      }
    });
  });

  describe('isOpen', () => {
    it('returns true while open', () => {
      expect(db.isOpen).toBe(true);
    });

    it('returns false after close', async () => {
      const instance = await GrafeoDB.create();
      await instance.close();
      expect(instance.isOpen).toBe(false);
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

    it('throws on invalid query', async () => {
      await expect(db.execute('INVALID QUERY')).rejects.toThrow();
    });

    it('passes params to WASM executeWithParams', async () => {
      await db.execute("INSERT (:Person {name: 'Alice', age: 30})");
      const results = await db.execute(
        'MATCH (p:Person) RETURN p.name, p.age',
        { params: { name: 'Alice' } },
      );
      expect(results).toHaveLength(1);
    });

    it('works without params (backward compatible)', async () => {
      await db.execute("INSERT (:Person {name: 'Alice'})");
      const results = await db.execute('MATCH (p:Person) RETURN p.name');
      expect(results).toHaveLength(1);
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

    it('dropProjection returns true when it existed', async () => {
      await db.createProjection('social', ['Person']);
      const dropped = await db.dropProjection('social');
      expect(dropped).toBe(true);
    });

    it('dropProjection returns false when not found', async () => {
      const dropped = await db.dropProjection('nonexistent');
      expect(dropped).toBe(false);
    });

    it('listProjections returns created names', async () => {
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
      const pdb = await GrafeoDB.create({ persist: 'lite-proj-create' });
      const created = await pdb.createProjection('social', ['Person']);
      expect(created).toBe(true);
      await pdb.close();
    });

    it('triggers persistence on dropProjection', async () => {
      const pdb = await GrafeoDB.create({ persist: 'lite-proj-drop' });
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
    });
  });

  describe('clearPlanCache()', () => {
    it('does not throw', async () => {
      await expect(db.clearPlanCache()).resolves.toBeUndefined();
    });
  });

  describe('info()', () => {
    it('returns database information with mode and features', async () => {
      const dbInfo = await db.info();
      expect(dbInfo.mode).toBe('Lpg');
      expect(typeof dbInfo.version).toBe('string');
      expect(Array.isArray(dbInfo.features)).toBe(true);
      expect(dbInfo.features).toContain('gql');
    });

    it('throws when database is closed', async () => {
      const instance = await GrafeoDB.create();
      await instance.close();
      await expect(instance.info()).rejects.toThrow('Database is closed');
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
    });

    it('throws when database is closed', async () => {
      const instance = await GrafeoDB.create();
      await instance.close();
      await expect(instance.beginTransaction()).rejects.toThrow('Database is closed');
      await expect(instance.commitTransaction()).rejects.toThrow('Database is closed');
      await expect(instance.rollbackTransaction()).rejects.toThrow('Database is closed');
      await expect(instance.isTransactionActive()).rejects.toThrow('Database is closed');
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
      const pdb = await GrafeoDB.create({ persist: 'lite-tx-defer-execute' });
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
        await new PersistenceManager('lite-tx-defer-execute').clear();
      }
    });

    it('beginTransaction() calls cancel on the persistence manager', async () => {
      const pdb = await GrafeoDB.create({ persist: 'lite-tx-defer-cancel' });
      try {
        const persistence = getPersistence(pdb);
        const cancelSpy = vi.spyOn(persistence, 'cancel');
        await pdb.execute("INSERT (:Person {name: 'Alice'})");
        await pdb.beginTransaction();
        expect(cancelSpy).toHaveBeenCalled();
        await pdb.rollbackTransaction();
        cancelSpy.mockRestore();
      } finally {
        await pdb.close();
        const { PersistenceManager } = await import('./persistence');
        await new PersistenceManager('lite-tx-defer-cancel').clear();
      }
    });

    it('commitTransaction() calls scheduleSave', async () => {
      const pdb = await GrafeoDB.create({ persist: 'lite-tx-defer-commit' });
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
        await new PersistenceManager('lite-tx-defer-commit').clear();
      }
    });

    it('rollbackTransaction() calls scheduleSave (post-rollback state must land on disk)', async () => {
      const pdb = await GrafeoDB.create({ persist: 'lite-tx-defer-rollback' });
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
        await new PersistenceManager('lite-tx-defer-rollback').clear();
      }
    });

    it('after commit, subsequent execute() resumes calling scheduleSave normally', async () => {
      const pdb = await GrafeoDB.create({ persist: 'lite-tx-defer-resume' });
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
        await new PersistenceManager('lite-tx-defer-resume').clear();
      }
    });

    it('execute() schedules save after import() during a tx (no stale flag leak)', async () => {
      const pdb = await GrafeoDB.create({ persist: 'lite-tx-stale-flag-import' });
      try {
        const persistence = getPersistence(pdb);
        await pdb.execute("INSERT (:Person {name: 'Alice'})");
        const snapshot = await pdb.export();
        await pdb.beginTransaction();
        await pdb.import(snapshot);
        const saveSpy = vi.spyOn(persistence, 'scheduleSave');
        await pdb.execute("INSERT (:Person {name: 'Bob'})");
        expect(saveSpy).toHaveBeenCalled();
        saveSpy.mockRestore();
      } finally {
        await pdb.close();
        const { PersistenceManager } = await import('./persistence');
        await new PersistenceManager('lite-tx-stale-flag-import').clear();
      }
    });

    it('execute() schedules save after signedImport() during a tx', async () => {
      const pdb = await GrafeoDB.create({ persist: 'lite-tx-stale-flag-signed' });
      try {
        const persistence = getPersistence(pdb);
        const key = new Uint8Array([1, 2, 3, 4]);
        await pdb.execute("INSERT (:Person {name: 'Alice'})");
        const signed = await pdb.signedExport(key);
        await pdb.beginTransaction();
        await pdb.signedImport(signed, key);
        const saveSpy = vi.spyOn(persistence, 'scheduleSave');
        await pdb.execute("INSERT (:Person {name: 'Bob'})");
        expect(saveSpy).toHaveBeenCalled();
        saveSpy.mockRestore();
      } finally {
        await pdb.close();
        const { PersistenceManager } = await import('./persistence');
        await new PersistenceManager('lite-tx-stale-flag-signed').clear();
      }
    });

    it('execute() schedules save after clear() during a tx', async () => {
      const pdb = await GrafeoDB.create({ persist: 'lite-tx-stale-flag-clear' });
      try {
        const persistence = getPersistence(pdb);
        await pdb.execute("INSERT (:Person {name: 'Alice'})");
        await pdb.beginTransaction();
        await pdb.clear();
        const saveSpy = vi.spyOn(persistence, 'scheduleSave');
        await pdb.execute("INSERT (:Person {name: 'Bob'})");
        expect(saveSpy).toHaveBeenCalled();
        saveSpy.mockRestore();
      } finally {
        await pdb.close();
        const { PersistenceManager } = await import('./persistence');
        await new PersistenceManager('lite-tx-stale-flag-clear').clear();
      }
    });
  });

  describe('signed snapshots', () => {
    const key = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    it('signedExport returns a Uint8Array prefixed with GSN1', async () => {
      await db.execute("INSERT (:Person {name: 'Alice'})");
      const signed = await db.signedExport(key);
      expect(signed).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(signed.slice(0, 4))).toBe('GSN1');
    });

    it('signedExport + signedImport round-trips state', async () => {
      await db.execute("INSERT (:Person {name: 'Alice'})");
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

    it('throws when database is closed', async () => {
      const instance = await GrafeoDB.create();
      await instance.close();
      await expect(instance.signedExport(key)).rejects.toThrow('Database is closed');
      await expect(instance.signedImport(new Uint8Array([0]), key)).rejects.toThrow('Database is closed');
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
});
