import { describe, expect, it, vi } from 'vitest';

// Mock the WASM module before importing GrafeoDB
vi.mock('@grafeo-db/wasm', () => import('./__mocks__/wasm'));

const { GrafeoDB } = await import('./index');
type GrafeoDBInstance = Awaited<ReturnType<typeof GrafeoDB.create>>;

describe('error handling', () => {
  describe('T4: concurrent createGrafeo() calls', () => {
    it('resolves all 10 concurrent create() calls without double-init crash', async () => {
      const promises = Array.from({ length: 10 }, () => GrafeoDB.create());
      const instances = await Promise.all(promises);

      expect(instances).toHaveLength(10);
      for (const instance of instances) {
        expect(instance).toBeDefined();
        expect(instance).toHaveProperty('execute');
        expect(instance.isOpen).toBe(true);
      }

      // Clean up all instances
      await Promise.all(instances.map((db) => db.close()));
    });

    it('concurrent creates with persistence all resolve', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        GrafeoDB.create({ persist: `concurrent-test-${i}` }),
      );
      const instances = await Promise.all(promises);

      expect(instances).toHaveLength(10);
      for (const instance of instances) {
        expect(instance.isOpen).toBe(true);
      }

      await Promise.all(instances.map((db) => db.close()));
    });
  });

  describe('T5: use after close', () => {
    it('execute() on closed db throws clear error about closed database', async () => {
      const db = await GrafeoDB.create();
      await db.close();

      await expect(
        db.execute('MATCH (n) RETURN n'),
      ).rejects.toThrow('Database is closed');
    });

    it('executeRaw() on closed db throws clear error', async () => {
      const db = await GrafeoDB.create();
      await db.close();

      await expect(
        db.executeRaw('MATCH (n) RETURN n'),
      ).rejects.toThrow('Database is closed');
    });

    it('nodeCount() on closed db throws clear error', async () => {
      const db = await GrafeoDB.create();
      await db.close();

      await expect(db.nodeCount()).rejects.toThrow('Database is closed');
    });

    it('edgeCount() on closed db throws clear error', async () => {
      const db = await GrafeoDB.create();
      await db.close();

      await expect(db.edgeCount()).rejects.toThrow('Database is closed');
    });

    it('schema() on closed db throws clear error', async () => {
      const db = await GrafeoDB.create();
      await db.close();

      await expect(db.schema()).rejects.toThrow('Database is closed');
    });

    it('export() on closed db throws clear error', async () => {
      const db = await GrafeoDB.create();
      await db.close();

      await expect(db.export()).rejects.toThrow('Database is closed');
    });

    it('import() on closed db throws clear error', async () => {
      const db = await GrafeoDB.create();
      const snapshot = await db.export();
      await db.close();

      await expect(db.import(snapshot)).rejects.toThrow('Database is closed');
    });

    it('clear() on closed db throws clear error', async () => {
      const db = await GrafeoDB.create();
      await db.close();

      await expect(db.clear()).rejects.toThrow('Database is closed');
    });

    it('isOpen returns false after close', async () => {
      const db = await GrafeoDB.create();
      expect(db.isOpen).toBe(true);
      await db.close();
      expect(db.isOpen).toBe(false);
    });
  });

  describe('T11: feature detection for missing WASM features', () => {
    it('vectorSearch throws clear error when vector-index feature is absent', async () => {
      const db: GrafeoDBInstance = await GrafeoDB.create();
      const wasm = (db as unknown as { wasm: Record<string, unknown> }).wasm;
      Object.defineProperty(wasm, 'vectorSearch', {
        value: undefined,
        configurable: true,
      });

      await expect(
        db.vectorSearch('Doc', 'embedding', new Float32Array([1, 0, 0]), 5),
      ).rejects.toThrow(
        "vectorSearch() requires @grafeo-db/wasm built with the 'vector-index' feature",
      );

      await db.close();
    });

    it('mmrSearch throws clear error when vector-index feature is absent', async () => {
      const db: GrafeoDBInstance = await GrafeoDB.create();
      const wasm = (db as unknown as { wasm: Record<string, unknown> }).wasm;
      Object.defineProperty(wasm, 'mmrSearch', {
        value: undefined,
        configurable: true,
      });

      await expect(
        db.mmrSearch('Doc', 'embedding', new Float32Array([1, 0, 0]), 5),
      ).rejects.toThrow(
        "mmrSearch() requires @grafeo-db/wasm built with the 'vector-index' feature",
      );

      await db.close();
    });

    it('createVectorIndex throws clear error when vector-index feature is absent', async () => {
      const db: GrafeoDBInstance = await GrafeoDB.create();
      const wasm = (db as unknown as { wasm: Record<string, unknown> }).wasm;
      Object.defineProperty(wasm, 'createVectorIndex', {
        value: undefined,
        configurable: true,
      });

      await expect(
        db.createVectorIndex('Doc', 'embedding'),
      ).rejects.toThrow(
        "createVectorIndex() requires @grafeo-db/wasm built with the 'vector-index' feature",
      );

      await db.close();
    });

    it('textSearch throws clear error when text-index feature is absent', async () => {
      const db: GrafeoDBInstance = await GrafeoDB.create();
      const wasm = (db as unknown as { wasm: Record<string, unknown> }).wasm;
      Object.defineProperty(wasm, 'textSearch', {
        value: undefined,
        configurable: true,
      });

      await expect(
        db.textSearch('Person', 'name', 'Alice', 5),
      ).rejects.toThrow(
        "textSearch() requires @grafeo-db/wasm built with the 'text-index' feature",
      );

      await db.close();
    });

    it('hybridSearch throws clear error when hybrid-search feature is absent', async () => {
      const db: GrafeoDBInstance = await GrafeoDB.create();
      const wasm = (db as unknown as { wasm: Record<string, unknown> }).wasm;
      Object.defineProperty(wasm, 'hybridSearch', {
        value: undefined,
        configurable: true,
      });

      await expect(
        db.hybridSearch('Person', 'name', 'embedding', 'Alice', 5),
      ).rejects.toThrow(
        "hybridSearch() requires @grafeo-db/wasm built with the 'hybrid-search' feature",
      );

      await db.close();
    });

    it('importRdf throws clear error when rdf feature is absent', async () => {
      const db: GrafeoDBInstance = await GrafeoDB.create();
      const wasm = (db as unknown as { wasm: Record<string, unknown> }).wasm;
      Object.defineProperty(wasm, 'importRdf', {
        value: undefined,
        configurable: true,
      });

      await expect(
        db.importRdf({ triples: [] }),
      ).rejects.toThrow(
        "importRdf() requires @grafeo-db/wasm built with the 'rdf' feature",
      );

      await db.close();
    });
  });
});
