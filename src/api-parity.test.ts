import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@grafeo-db/wasm', () => import('./__mocks__/wasm'));
vi.mock('@grafeo-db/wasm-lite', () => import('./__mocks__/wasm'));

const { GrafeoDB } = await import('./index');
const { GrafeoDB: GrafeoDBLite } = await import('./lite');
const { WorkerProxy } = await import('./worker-proxy');
type GrafeoDBInstance = Awaited<ReturnType<typeof GrafeoDB.create>>;

describe('API parity', () => {
  describe('T3: worker proxy methods vs main API methods', () => {
    it('WorkerProxy covers all public async methods on GrafeoDB instances', async () => {
      const db = await GrafeoDB.create();

      // Collect public methods from the GrafeoDB instance (excluding static, getter, and private methods)
      const instanceMethods = Object.getOwnPropertyNames(
        Object.getPrototypeOf(db),
      ).filter((name) => {
        if (name === 'constructor') return false;
        if (name.startsWith('_')) return false;
        // Skip private methods (assertOpen, assertFeature)
        if (name === 'assertOpen' || name === 'assertFeature') return false;
        // Skip getter properties (isOpen)
        const descriptor = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(db),
          name,
        );
        if (descriptor?.get) return false;
        return typeof (db as unknown as Record<string, unknown>)[name] === 'function';
      });

      // Collect public methods from WorkerProxy prototype
      const proxyMethods = Object.getOwnPropertyNames(
        WorkerProxy.prototype,
      ).filter((name) => {
        if (name === 'constructor') return false;
        if (name.startsWith('_')) return false;
        return typeof WorkerProxy.prototype[name as keyof typeof WorkerProxy.prototype] === 'function';
      });

      // Every instance method should have a corresponding proxy method
      // (excluding changesSince which is a stub returning [])
      const expectedInProxy = instanceMethods.filter(
        (m) => m !== 'changesSince' && m !== 'getVersion',
      );

      const missingFromProxy = expectedInProxy.filter(
        (m) => !proxyMethods.includes(m),
      );

      expect(
        missingFromProxy,
        `WorkerProxy is missing methods: ${missingFromProxy.join(', ')}`,
      ).toEqual([]);

      await db.close();
    });
  });

  describe('T10: schema after mutations', () => {
    let db: GrafeoDBInstance;

    beforeEach(async () => {
      db = await GrafeoDB.create();
    });

    afterEach(async () => {
      await db.close();
    });

    it('schema reflects created node labels', async () => {
      await db.execute("INSERT (:Person {name: 'Alice', age: 30})");

      const schema = await db.schema();

      const labelNames = schema.labels.map((l) => l.name);
      expect(labelNames).toContain('Person');
      expect(schema.property_keys).toContain('name');
      expect(schema.property_keys).toContain('age');
    });

    it('schema updates after additional mutations', async () => {
      await db.execute("INSERT (:Person {name: 'Alice'})");

      const schema1 = await db.schema();
      const labelNames1 = schema1.labels.map((l) => l.name);
      expect(labelNames1).toContain('Person');
      expect(schema1.edge_types).toHaveLength(0);

      // Add a new label and edge type
      await db.execute(
        "INSERT (:Company {name: 'Acme'})-[:EMPLOYS]->(:Person {name: 'Bob'})",
      );

      const schema2 = await db.schema();
      const labelNames2 = schema2.labels.map((l) => l.name);
      expect(labelNames2).toContain('Person');
      expect(labelNames2).toContain('Company');
      expect(schema2.edge_types).toContain('EMPLOYS');
    });

    it('schema starts empty for a fresh database', async () => {
      const schema = await db.schema();

      expect(schema.labels).toHaveLength(0);
      expect(schema.edge_types).toHaveLength(0);
      expect(schema.property_keys).toHaveLength(0);
    });
  });

  describe('T12: lite build exports match documented subset', () => {
    it('lite GrafeoDB exposes the expected core methods', async () => {
      const db = await GrafeoDBLite.create();

      const expectedMethods = [
        'execute',
        'executeRaw',
        'nodeCount',
        'edgeCount',
        'schema',
        'export',
        'import',
        'clear',
        'close',
        'changesSince',
        'storageStats',
        'setSchema',
        'resetSchema',
        'currentSchema',
        'clearPlanCache',
        'info',
      ];

      for (const method of expectedMethods) {
        expect(
          typeof (db as unknown as Record<string, unknown>)[method],
          `lite build should expose ${method}`,
        ).toBe('function');
      }

      await db.close();
    });

    it('lite GrafeoDB does NOT expose full-build-only methods', async () => {
      const db = await GrafeoDBLite.create();

      const fullOnlyMethods = [
        'vectorSearch',
        'mmrSearch',
        'createVectorIndex',
        'dropVectorIndex',
        'rebuildVectorIndex',
        'textSearch',
        'hybridSearch',
        'createTextIndex',
        'dropTextIndex',
        'rebuildTextIndex',
        'importRows',
        'importLpg',
        'importRdf',
        'memoryUsage',
        'getVersion',
      ];

      for (const method of fullOnlyMethods) {
        expect(
          typeof (db as unknown as Record<string, unknown>)[method],
          `lite build should NOT expose ${method}`,
        ).not.toBe('function');
      }

      await db.close();
    });

    it('lite GrafeoDB has isOpen property', async () => {
      const db = await GrafeoDBLite.create();
      expect(db.isOpen).toBe(true);
      await db.close();
      expect(db.isOpen).toBe(false);
    });

    it('lite GrafeoDB.create is a static factory method', () => {
      expect(typeof GrafeoDBLite.create).toBe('function');
    });
  });
});
