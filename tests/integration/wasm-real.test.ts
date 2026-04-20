/**
 * Integration tests using the real @grafeo-db/wasm binary (not mocks).
 *
 * These tests verify that grafeo-web works correctly with the actual
 * WASM engine. Run with: npx vitest run --config vitest.integration.config.ts
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Load the WASM module manually for Node.js (no fetch/URL support)
const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(__dirname, '../../node_modules/@grafeo-db/wasm/grafeo_wasm_bg.wasm');
const wasmModule = await import('@grafeo-db/wasm');
const wasmBytes = await readFile(wasmPath);
await wasmModule.default(wasmBytes);

const { Database } = wasmModule;

describe('Real WASM: Database basics', () => {
  it('creates a database and returns version', () => {
    const version = Database.version();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    expect(version).toContain('0.5.');
  });

  it('inserts and queries nodes (GQL)', () => {
    const db = new Database();
    db.execute("INSERT (:Person {name: 'Alice', age: 30})");
    db.execute("INSERT (:Person {name: 'Bob', age: 25})");

    const results = db.execute('MATCH (p:Person) RETURN p.name, p.age ORDER BY p.age');
    expect(results).toHaveLength(2);
    expect(results[0]['p.name']).toBe('Bob');
    expect(results[0]['p.age']).toBe(25);
    expect(results[1]['p.name']).toBe('Alice');
    expect(results[1]['p.age']).toBe(30);

    db.free();
  });

  it('supports parameterized queries', () => {
    const db = new Database();
    db.execute("INSERT (:Person {name: 'Alice'})");
    db.execute("INSERT (:Person {name: 'Bob'})");

    const results = db.executeWithParams(
      'MATCH (p:Person) WHERE p.name = $name RETURN p.name',
      { name: 'Alice' },
    );
    expect(results).toHaveLength(1);
    expect(results[0]['p.name']).toBe('Alice');

    db.free();
  });

  it('supports multi-language queries (Cypher)', () => {
    const db = new Database();
    db.execute("INSERT (:Person {name: 'Alice'})");

    const results = db.executeWithLanguage(
      "MATCH (p:Person) RETURN p.name",
      'cypher',
    );
    expect(results).toHaveLength(1);
    expect(results[0]['p.name']).toBe('Alice');

    db.free();
  });

  it('executeRaw returns columns and rows', () => {
    const db = new Database();
    db.execute("INSERT (:Person {name: 'Alice'})");

    const raw = db.executeRaw('MATCH (p:Person) RETURN p.name');
    expect(raw.columns).toContain('p.name');
    expect(raw.rows).toHaveLength(1);

    db.free();
  });

  it('nodeCount and edgeCount', () => {
    const db = new Database();
    expect(db.nodeCount()).toBe(0);
    expect(db.edgeCount()).toBe(0);

    db.execute("INSERT (:Person {name: 'Alice'})");
    db.execute("INSERT (:Person {name: 'Bob'})");
    expect(db.nodeCount()).toBe(2);

    db.execute("MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'}) INSERT (a)-[:KNOWS]->(b)");
    expect(db.edgeCount()).toBe(1);

    db.free();
  });

  it('schema returns typed information', () => {
    const db = new Database();
    db.execute("INSERT (:Person {name: 'Alice', age: 30})");
    db.execute("INSERT (:Company {name: 'Acme'})");

    const schema = db.schema() as {
      mode: string;
      labels: { name: string; count: number }[];
      edge_types: string[];
      property_keys: string[];
    };
    expect(schema.mode).toBe('lpg');
    const labelNames = schema.labels.map((l) => l.name);
    expect(labelNames).toContain('Person');
    expect(labelNames).toContain('Company');
    expect(schema.property_keys).toContain('name');
    expect(schema.property_keys).toContain('age');

    db.free();
  });
});

describe('Real WASM: Snapshot export/import', () => {
  it('round-trips data through exportSnapshot/importSnapshot', () => {
    const db = new Database();
    db.execute("INSERT (:Person {name: 'Alice', age: 30})");
    db.execute("INSERT (:Person {name: 'Bob', age: 25})");
    db.execute("MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'}) INSERT (a)-[:KNOWS]->(b)");

    const snapshot = db.exportSnapshot();
    expect(snapshot).toBeInstanceOf(Uint8Array);
    expect(snapshot.length).toBeGreaterThan(0);

    const db2 = Database.importSnapshot(snapshot);
    expect(db2.nodeCount()).toBe(2);
    expect(db2.edgeCount()).toBe(1);

    const results = db2.execute('MATCH (p:Person) RETURN p.name ORDER BY p.name');
    expect(results).toHaveLength(2);
    expect(results[0]['p.name']).toBe('Alice');
    expect(results[1]['p.name']).toBe('Bob');

    db.free();
    db2.free();
  });

  it('importSnapshot with invalid data throws', () => {
    expect(() => Database.importSnapshot(new Uint8Array([0xFF, 0x00]))).toThrow();
  });
});

describe('Real WASM: Unicode support (0.5.38)', () => {
  it('handles Unicode identifiers in GQL', () => {
    const db = new Database();
    db.execute("INSERT (:人物 {名前: 'アリス'})");

    const results = db.execute('MATCH (p:人物) RETURN p.名前');
    expect(results).toHaveLength(1);
    expect(results[0]['p.名前']).toBe('アリス');

    db.free();
  });

  it('GQL != operator works', () => {
    const db = new Database();
    db.execute("INSERT (:Person {name: 'Alice'})");
    db.execute("INSERT (:Person {name: 'Bob'})");

    const results = db.execute("MATCH (p:Person) WHERE p.name != 'Alice' RETURN p.name");
    expect(results).toHaveLength(1);
    expect(results[0]['p.name']).toBe('Bob');

    db.free();
  });
});

describe('Real WASM: Edges and relationships', () => {
  it('creates and queries edges with properties', () => {
    const db = new Database();
    db.execute("INSERT (:Person {name: 'Alice'})");
    db.execute("INSERT (:Person {name: 'Bob'})");
    db.execute("MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'}) INSERT (a)-[:KNOWS {since: 2020}]->(b)");

    const results = db.execute('MATCH (a)-[r:KNOWS]->(b) RETURN a.name, b.name, r.since');
    expect(results).toHaveLength(1);
    expect(results[0]['a.name']).toBe('Alice');
    expect(results[0]['b.name']).toBe('Bob');
    expect(results[0]['r.since']).toBe(2020);

    db.free();
  });
});

describe('Real WASM: Bulk import', () => {
  it('importLpg imports nodes and edges', () => {
    const db = new Database();
    const result = db.importLpg({
      nodes: [
        { labels: ['Person'], properties: { name: 'Alice' } },
        { labels: ['Person'], properties: { name: 'Bob' } },
      ],
      edges: [
        { source: 0, target: 1, type: 'KNOWS', properties: { since: 2020 } },
      ],
    });

    expect(result.nodes).toBe(2);
    expect(result.edges).toBe(1);
    expect(db.nodeCount()).toBe(2);
    expect(db.edgeCount()).toBe(1);

    db.free();
  });
});

describe('Real WASM: advertised query languages are compiled in', () => {
  // Guards against the main pkg being built without a language feature flag
  // (e.g. --features ai instead of --features full), which would make
  // executeWithLanguage throw "Unknown query language: '<lang>'" at runtime.
  //
  // We do NOT assert the query succeeds - parse/semantic errors on an empty
  // DB are acceptable. We only assert the dispatcher recognised the language.
  const probes: { language: string; query: string }[] = [
    { language: 'gql', query: 'MATCH (n) RETURN n' },
    { language: 'cypher', query: 'MATCH (n) RETURN n' },
    { language: 'sparql', query: 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }' },
    { language: 'gremlin', query: 'g.V()' },
    { language: 'graphql', query: '{ __typename }' },
    { language: 'sql', query: 'SELECT * FROM GRAPH_TABLE (MATCH (n) COLUMNS (n AS x)) AS g' },
  ];

  for (const { language, query } of probes) {
    it(`dispatches '${language}' without "Unknown query language"`, () => {
      const db = new Database();
      try {
        db.executeWithLanguage(query, language);
      } catch (e) {
        const msg = (e as Error).message;
        expect(
          msg,
          `language '${language}' not compiled into main pkg - rebuild with --features full`,
        ).not.toContain('Unknown query language');
      } finally {
        db.free();
      }
    });
  }
});

describe('Real WASM: info and memoryUsage', () => {
  it('info returns database metadata', () => {
    const db = new Database();
    const info = db.info() as Record<string, unknown>;
    expect(info).toHaveProperty('version');
    expect(info).toHaveProperty('features');
    db.free();
  });

  it('memoryUsage returns breakdown', () => {
    const db = new Database();
    const usage = db.memoryUsage() as Record<string, unknown>;
    expect(usage).toHaveProperty('total_bytes');
    expect(typeof (usage as { total_bytes: number }).total_bytes).toBe('number');
    db.free();
  });
});
