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

import { COMPACT_PANICS_IN } from '../../src/engine-quirks';

// Load the WASM module manually for Node.js (no fetch/URL support).
// A --target web build exports a `default` init fn; a --target bundler build
// (what npm ships) initializes on import and has no `default` (see wasm-init.ts).
const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(__dirname, '../../node_modules/@grafeo-db/wasm/grafeo_wasm_bg.wasm');
const wasmModule = await import('@grafeo-db/wasm');
const init = (wasmModule as { default?: (bytes: Uint8Array) => Promise<unknown> }).default;
if (typeof init === 'function') {
  await init(await readFile(wasmPath));
}

const { Database } = wasmModule;
const lite = await import('@grafeo-db/wasm-lite');
const LiteDatabase = lite.Database;

const fixture = async (name: string) =>
  new Uint8Array(await readFile(resolve(__dirname, '../fixtures', name)));

describe('Real WASM: Database basics', () => {
  it('creates a database and returns version', () => {
    const version = Database.version();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    expect(version).toMatch(/^0\.6\.2($|-)/);
    expect(LiteDatabase.version()).toBe(version);
  });

  // 0.6: a lone INSERT returns no rows (0.5.x returned the created node).
  it('INSERT returns no rows', () => {
    const db = new Database();
    expect(db.execute("INSERT (:Person {name: 'Alix'})")).toEqual([]);
    expect(db.executeRaw("INSERT (:Person {name: 'Gus'})")).toMatchObject({ columns: [], rows: [] });
    db.free();
  });

  // 0.6: executeRaw* takes parameters, lists and maps included.
  it('executeRawWithParams and executeRawWithLanguageAndParams', () => {
    const db = new Database();
    expect(db.executeRawWithParams('RETURN $tags AS tags', { tags: ['a', 'b'] })).toMatchObject({
      columns: ['tags'],
      rows: [[['a', 'b']]],
    });
    expect(
      db.executeRawWithLanguageAndParams('RETURN $city AS city', 'cypher', { city: { name: 'Utrecht' } }),
    ).toMatchObject({ columns: ['city'], rows: [[{ name: 'Utrecht' }]] });
    db.free();
  });

  // 0.6: GQL sorts nulls last in both directions.
  it('GQL ORDER BY DESC puts nulls last', () => {
    const db = new Database();
    expect(db.execute('UNWIND [1, null, 3] AS v RETURN v ORDER BY v DESC')).toEqual([
      { v: 3 },
      { v: 1 },
      { v: null },
    ]);
    db.free();
  });

  // 0.6: a statement nests at most 64 levels deep; deeper fails cleanly
  // instead of overflowing the stack (which broke the whole WASM module).
  it('refuses a statement nested past the limit and keeps working', () => {
    const db = new Database();
    const deep = 'RETURN ' + '('.repeat(80) + '1' + ')'.repeat(80) + ' AS x';
    expect(() => db.execute(deep)).toThrow(/nesting depth/);
    expect(db.execute('RETURN 1 AS x')).toEqual([{ x: 1 }]);
    db.free();
  });

  // 0.6: error messages start with their Grafeo code.
  it('errors carry their Grafeo code', () => {
    const db = new Database();
    expect(() => db.execute('MATCH (n RETURN n')).toThrow(/^GRAFEO-Q001: syntax error/);
    db.free();
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

  it('schema lists labels and edge types with their properties and endpoints, sorted by name', () => {
    const db = new Database();
    db.execute(
      "INSERT (:Person {name: 'Alix', age: 30})-[:KNOWS {since: 2020}]->(:Person {name: 'Gus'})-[:LIVES_IN]->(:City {name: 'Utrecht', price: 2.50})",
    );
    expect(db.schema()).toEqual({
      mode: 'lpg',
      labels: [
        {
          name: 'City',
          count: 1,
          properties: [
            { name: 'name', types: ['STRING'] },
            { name: 'price', types: ['DECIMAL'] },
          ],
        },
        {
          name: 'Person',
          count: 2,
          properties: [
            { name: 'age', types: ['INT64'] },
            { name: 'name', types: ['STRING'] },
          ],
        },
      ],
      edge_types: [
        {
          name: 'KNOWS',
          count: 1,
          properties: [{ name: 'since', types: ['INT64'] }],
          endpoints: [{ source: 'Person', target: 'Person', count: 1 }],
        },
        {
          name: 'LIVES_IN',
          count: 1,
          properties: [],
          endpoints: [{ source: 'Person', target: 'City', count: 1 }],
        },
      ],
      property_keys: ['age', 'name', 'price', 'since'],
    });
    db.free();
  });

  it('schema lists only what is in use', () => {
    const db = new Database();
    db.execute("INSERT (:Person {name: 'Alix'})");
    db.detachDeleteNode(0);
    expect(db.schema()).toEqual({ mode: 'lpg', labels: [], edge_types: [], property_keys: [] });
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

// tests/fixtures/snapshot-v4-wasm-0.5.42.bin was exported by @grafeo-db/wasm 0.5.42 after:
//   INSERT (:Person {name: 'Alix', age: 30})-[:KNOWS {since: 2020}]->(:Person {name: 'Gus', age: 25})
//   INSERT (:City {name: 'Utrecht', tags: ['a','b'], score: 1.5, ok: true})
//   CREATE INDEX person_name FOR (p:Person) ON (p.name)
//   INSERT DATA { <http://ex/a> <http://ex/knows> <http://ex/b> }   (SPARQL)
// snapshot-v4-wasm-0.5.44.bin by @grafeo-db/wasm 0.5.44 after the same, plus:
//   INSERT (:Doc {title: 'graphs', body: 'graph databases in the browser', emb: vector([1.0, 0.0, 0.0])})
//   INSERT (:Doc {title: 'cooking', body: 'a recipe for soup', emb: vector([0.0, 1.0, 0.0])})
//   db.createTextIndex('Doc', 'body')
//   db.createVectorIndex('Doc', 'emb', { dimensions: 3, metric: 'cosine' })
// snapshot-v4-wasm-lite-0.5.44.bin by @grafeo-db/wasm-lite 0.5.44 after the
// first three statements (the lite build has no SPARQL).
// snapshot-v5-wasm-0.6.0.bin by @grafeo-db/wasm 0.6.0 after the first two of
// these (City also has price: 2.50), the same index, the SPARQL insert, and:
//   db.createTextIndex('Doc', 'body', { tokenizer: 'standard', k1: 1.5 })
//   db.createVectorIndex('Doc', 'emb', { dimensions: 3, metric: 'cosine' })
// snapshot-v5-wasm-lite-0.6.0.bin by @grafeo-db/wasm-lite 0.6.0 after the same
// first three statements.
// IndexedDB keeps such snapshots across upgrades, so a release must still load
// them, or ship a deliberate migration and update these tests.
// 0.6: SPARQL bindings are RDF/JS terms, not strings.
const iri = (value: string) => ({ termType: 'NamedNode', value });

describe('Real WASM: snapshots persisted by earlier releases', () => {
  it('imports a v4 snapshot exported by wasm 0.5.42', async () => {
    const data = await fixture('snapshot-v4-wasm-0.5.42.bin');
    expect(data[0]).toBe(4);
    const db = Database.importSnapshot(data);

    expect(db.nodeCount()).toBe(3);
    expect(db.edgeCount()).toBe(1);
    expect(db.execute('MATCH (a:Person)-[k:KNOWS]->(b) RETURN a.name, k.since, b.name')).toEqual([
      { 'a.name': 'Alix', 'k.since': 2020, 'b.name': 'Gus' },
    ]);
    expect(db.execute('MATCH (c:City) RETURN c.name, c.tags, c.score, c.ok')).toEqual([
      { 'c.name': 'Utrecht', 'c.tags': ['a', 'b'], 'c.score': 1.5, 'c.ok': true },
    ]);
    expect(db.executeWithLanguage('SELECT ?s ?o WHERE { ?s <http://ex/knows> ?o }', 'sparql')).toEqual([
      { s: iri('http://ex/a'), o: iri('http://ex/b') },
    ]);

    db.free();
  });

  it('imports a v4 snapshot exported by wasm 0.5.44, with its text and vector indexes', async () => {
    const data = await fixture('snapshot-v4-wasm-0.5.44.bin');
    expect(data[0]).toBe(4);
    const db = Database.importSnapshot(data);

    expect(db.nodeCount()).toBe(5);
    expect(db.edgeCount()).toBe(1);
    expect(db.execute("MATCH (p:Person {name: 'Gus'}) RETURN p.age")).toEqual([{ 'p.age': 25 }]);
    expect(db.textSearch('Doc', 'body', 'graph', 2).map((r: { id: number }) => r.id)).toEqual([3]);
    expect(db.vectorSearch('Doc', 'emb', new Float32Array([1, 0, 0]), 1, {})).toEqual([
      { id: 3, distance: expect.any(Number) },
    ]);
    expect(db.executeWithLanguage('SELECT ?s ?o WHERE { ?s <http://ex/knows> ?o }', 'sparql')).toEqual([
      { s: iri('http://ex/a'), o: iri('http://ex/b') },
    ]);

    db.free();
  });

  it('imports a v5 snapshot exported by wasm 0.6.0, with its indexes and their names', async () => {
    const data = await fixture('snapshot-v5-wasm-0.6.0.bin');
    expect(data[0]).toBe(5);
    const db = Database.importSnapshot(data);

    expect(db.nodeCount()).toBe(5);
    expect(db.edgeCount()).toBe(1);
    expect(db.execute('SHOW INDEXES')).toEqual([
      { name: 'person_name', type: 'Hash', label: 'Person', property: 'name' },
      { name: null, type: 'FullText', label: 'Doc', property: 'body' },
      { name: null, type: 'Vector', label: 'Doc', property: 'emb' },
    ]);
    expect(db.execute('MATCH (c:City) RETURN c.tags, c.score, c.ok, c.price')).toEqual([
      { 'c.tags': ['a', 'b'], 'c.score': 1.5, 'c.ok': true, 'c.price': { $decimal: '2.50' } },
    ]);
    expect(db.textSearch('Doc', 'body', 'graph', 2).map((r: { id: number }) => r.id)).toEqual([3]);
    expect(db.vectorSearch('Doc', 'emb', new Float32Array([1, 0, 0]), 1, {})).toEqual([
      { id: 3, distance: expect.any(Number) },
    ]);
    expect(db.executeWithLanguage('SELECT ?s ?o WHERE { ?s <http://ex/knows> ?o }', 'sparql')).toEqual([
      { s: iri('http://ex/a'), o: iri('http://ex/b') },
    ]);
    db.free();
  });

  it('wasm-lite imports a v5 snapshot exported by wasm-lite 0.6.0', async () => {
    const data = await fixture('snapshot-v5-wasm-lite-0.6.0.bin');
    expect(data[0]).toBe(5);
    const db = LiteDatabase.importSnapshot(data);
    expect(db.nodeCount()).toBe(3);
    expect(db.edgeCount()).toBe(1);
    expect(db.execute('SHOW INDEXES')).toEqual([
      { name: 'person_name', type: 'Hash', label: 'Person', property: 'name' },
    ]);
    db.free();
  });

  it('round-trips an upgraded snapshot as v5, keeping index names', async () => {
    const db = Database.importSnapshot(await fixture('snapshot-v4-wasm-0.5.44.bin'));
    db.execute("INSERT (:Person {name: 'Vincent', age: 41})");
    const exported = db.exportSnapshot();
    expect(exported[0]).toBe(5);

    const again = Database.importSnapshot(exported);
    expect(again.nodeCount()).toBe(6);
    expect(again.textSearch('Doc', 'body', 'graph', 2).map((r: { id: number }) => r.id)).toEqual([3]);
    // The v4 property index carries over and is used. v4 never stored its
    // name, so SHOW INDEXES does not list it.
    expect(again.execute("EXPLAIN MATCH (p:Person {name: 'Gus'}) RETURN p")[0].plan).toContain('[index: name]');
    db.free();
    again.free();
  });

  it('v5 snapshots keep index names', () => {
    const db = new Database();
    db.execute('CREATE INDEX person_name FOR (p:Person) ON (p.name)');
    const again = Database.importSnapshot(db.exportSnapshot());
    expect(again.execute('SHOW INDEXES')).toEqual([
      { name: 'person_name', type: 'Hash', label: 'Person', property: 'name' },
    ]);
    db.free();
    again.free();
  });

  it('wasm-lite imports a v4 snapshot exported by wasm-lite 0.5.44', async () => {
    const data = await fixture('snapshot-v4-wasm-lite-0.5.44.bin');
    expect(data[0]).toBe(4);
    const db = LiteDatabase.importSnapshot(data);
    expect(db.nodeCount()).toBe(3);
    expect(db.edgeCount()).toBe(1);
    expect(db.execute('MATCH (c:City) RETURN c.name, c.tags, c.score, c.ok')).toEqual([
      { 'c.name': 'Utrecht', 'c.tags': ['a', 'b'], 'c.score': 1.5, 'c.ok': true },
    ]);
    db.free();
  });

  // 0.6: a build without the RDF store or the AI indexes refuses a snapshot
  // that holds them (0.5.x imported it and silently dropped that data).
  it('wasm-lite refuses a snapshot with data it cannot hold, naming it', async () => {
    const data = await fixture('snapshot-v4-wasm-0.5.44.bin');
    expect(() => LiteDatabase.importSnapshot(data)).toThrow(
      /GRAFEO-V001.*RDF triples.*vector indexes.*text indexes/,
    );
  });
});

describe('Real WASM: compact()', () => {
  // The wrapper refuses compact() on the builds listed in COMPACT_PANICS_IN.
  // This test keeps that list honest: a listed build must still panic, an
  // unlisted one must work.
  it.each([
    ['wasm', () => new Database()],
    ['wasm-lite', () => new LiteDatabase()],
  ])('%s: compact() works, or the build is listed as one where it panics', (_name, make) => {
    const db = make();
    if (COMPACT_PANICS_IN.has(Database.version())) {
      expect(() => db.compact()).toThrow();
      // The panic poisons the instance: what the wrapper's guard prevents.
      expect(() => db.nodeCount()).toThrow(/recursive use of an object/);
    } else {
      expect(db.compact()).toMatchObject({ checkpointed: false, versions_collected: expect.any(Number) });
      expect(db.nodeCount()).toBe(0);
      db.free();
    }
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

  // 0.5.44: direct writes are checked like INSERT, so bulk imports throw on a
  // constraint violation. 0.6.0: an import is all or nothing.
  it('importRows rejects a row that violates a UNIQUE constraint and writes nothing', () => {
    const db = new Database();
    db.execute('CREATE CONSTRAINT FOR (p:Person) ON (p.email) UNIQUE');

    expect(() =>
      db.importRows([{ email: 'a@x' }, { email: 'b@x' }, { email: 'a@x' }], {
        mode: 'nodes',
        label: 'Person',
      }),
    ).toThrow(/rows\[2\].*UNIQUE constraint violation/);
    expect(db.nodeCount()).toBe(0);

    db.free();
  });

  it('importLpg rejects a node that violates a UNIQUE constraint and writes nothing', () => {
    const db = new Database();
    db.execute('CREATE CONSTRAINT FOR (p:Person) ON (p.email) UNIQUE');

    expect(() =>
      db.importLpg({
        nodes: [
          { labels: ['Person'], properties: { email: 'c@x' } },
          { labels: ['Person'], properties: { email: 'c@x' } },
        ],
        edges: [],
      }),
    ).toThrow(/UNIQUE constraint violation/);
    expect(db.nodeCount()).toBe(0);

    db.free();
  });
});

describe('Real WASM: 0.6.1 behaviour', () => {
  const failure = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      return error as Error & { gqlStatus?: string };
    }
    throw new Error('it did not fail');
  };

  it.each([
    ['wasm', () => new Database()],
    ['wasm-lite', () => new LiteDatabase()],
  ])('%s: detachDeleteNode deletes a node with its edges, and in a transaction can be rolled back', (_name, make) => {
    const db = make();
    db.execute("INSERT (:Person {name: 'Alix'})-[:KNOWS]->(:Person {name: 'Gus'})");
    db.beginTransaction();
    expect(db.detachDeleteNode(0)).toBe(true);
    // A query reads through the transaction; nodeCount() reads what is committed.
    expect(db.execute('MATCH (p:Person) RETURN p.name')).toEqual([{ 'p.name': 'Gus' }]);
    db.rollbackTransaction();
    expect([db.nodeCount(), db.edgeCount()]).toEqual([2, 1]);
    db.beginTransaction();
    expect(db.detachDeleteNode(0)).toBe(true);
    db.commitTransaction();
    expect([db.nodeCount(), db.edgeCount()]).toEqual([1, 0]);
    expect(db.detachDeleteNode(0)).toBe(false);
    expect(() => db.detachDeleteNode(-1)).toThrow('-1 is not a node ID');
    expect(() => db.detachDeleteNode(1.5)).toThrow('1.5 is not a node ID');
    db.free();
  });

  it('transaction state errors carry a GQLSTATUS, and a statement cannot end a transaction', () => {
    const db = new Database();
    expect(failure(() => db.commitTransaction())).toMatchObject({
      message: 'No active transaction to commit.',
      gqlStatus: '25000',
    });
    expect(failure(() => db.rollbackTransaction())).toMatchObject({ gqlStatus: '25000' });
    db.beginTransaction();
    expect(failure(() => db.beginTransaction())).toMatchObject({ gqlStatus: '25G01' });
    for (const statement of ['COMMIT', 'ROLLBACK', 'START TRANSACTION']) {
      expect(failure(() => db.execute(statement))).toMatchObject({ gqlStatus: '25000' });
    }
    expect(db.isTransactionActive()).toBe(true);
    db.rollbackTransaction();
    db.free();
  });

  it('a signed snapshot that does not verify fails with 22000', () => {
    const db = new Database();
    const key = new Uint8Array(32).fill(7);
    const signed = db.exportSnapshotSigned(key);
    expect(failure(() => Database.importSnapshotSigned(signed, new Uint8Array(32).fill(8)))).toMatchObject({
      gqlStatus: '22000',
    });
    db.free();
  });

  it('START TRANSACTION ISOLATION LEVEL through execute() is refused and holds nothing open (0.6.2)', () => {
    const db = new Database();
    // 0.6.2 refuses START TRANSACTION on a per-call execute outright, before the
    // isolation level is read; 0.6.1 refused SERIALIZABLE itself with GRAFEO-Q004.
    expect(failure(() => db.execute('START TRANSACTION ISOLATION LEVEL SERIALIZABLE'))).toMatchObject({
      message: expect.stringMatching(/^GRAFEO-T004: /),
      gqlStatus: '25000',
    });
    expect(db.isTransactionActive()).toBe(false);
    db.free();
  });

  it('a Float32Array or Float64Array parameter is a vector', () => {
    const db = new Database();
    for (const array of [new Float32Array([0.5, 2]), new Float64Array([0.5, 2])]) {
      const [row] = db.executeWithParams('RETURN $v AS v, size($v) AS n', { v: array });
      expect(row.v).toBeInstanceOf(Float32Array);
      expect(Array.from(row.v as Float32Array)).toEqual([0.5, 2]);
      expect(row.n).toBe(2);
    }
    db.free();
  });

  it('a parameter nested too deep is refused and the module lives on', () => {
    const db = new Database();
    let deep: unknown = 1;
    for (let depth = 0; depth < 200_000; depth++) deep = [deep];
    expect(() => db.executeWithParams('RETURN $v AS v', { v: deep })).toThrow(/more than 128 levels deep/);
    expect(db.execute('RETURN 1 AS one')).toEqual([{ one: 1 }]);
    db.free();
  });

  it('a CAST that cannot hold fails; toInteger of text that is no number stays null', () => {
    const db = new Database();
    expect(failure(() => db.execute("RETURN CAST('abc' AS INTEGER) AS v"))).toMatchObject({ gqlStatus: '22018' });
    expect(failure(() => db.execute('RETURN CAST(1e300 AS INTEGER) AS v'))).toMatchObject({ gqlStatus: '22003' });
    expect(db.execute("RETURN toInteger('abc') AS a, toInteger(' 42 ') AS b, toInteger('4.2') AS c")).toEqual([
      { a: null, b: 42, c: 4 },
    ]);
    db.free();
  });

  it('a quantifier whose upper bound is below its lower bound is a syntax error in GQL', () => {
    const db = new Database();
    expect(failure(() => db.execute('MATCH (a)-[e]->{3,1}(b) RETURN a'))).toMatchObject({ gqlStatus: '42001' });
    db.free();
  });

  it('SPARQL refuses undeclared prefixes and variables in INSERT DATA, and predefines rdf:', () => {
    const db = new Database();
    const sparql = (query: string) => db.executeWithLanguage(query, 'sparql');
    expect(failure(() => sparql('SELECT ?s WHERE { ?s foo:bar ?o }'))).toMatchObject({ gqlStatus: '42001' });
    expect(failure(() => sparql('INSERT DATA { ?s <http://ex/k> <http://ex/b> }'))).toMatchObject({
      gqlStatus: '42001',
    });
    expect(sparql('SELECT ?s WHERE { ?s rdf:type ?o }')).toEqual([]);
    db.free();
  });

  it('a name stands for one index, a vector index keeps its name through a snapshot', () => {
    const db = new Database();
    db.execute('CREATE INDEX shared FOR (p:Person) ON (p.a)');
    expect(() => db.execute('CREATE INDEX shared FOR (q:Place) ON (q.b)')).toThrow("Index 'shared' already exists");
    db.execute("CREATE VECTOR INDEX doc_emb ON :Doc(emb) DIMENSION 3 METRIC 'cosine'");
    const again = Database.importSnapshot(db.exportSnapshot());
    expect(again.execute('SHOW INDEXES')).toEqual(
      expect.arrayContaining([{ name: 'doc_emb', type: 'Vector', label: 'Doc', property: 'emb' }]),
    );
    db.free();
    again.free();
  });
});

describe('Real WASM: 0.6.2 behaviour', () => {
  const failure = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      return error as Error & { gqlStatus?: string };
    }
    throw new Error('it did not fail');
  };

  it.each([
    ['wasm', () => new Database()],
    ['wasm-lite', () => new LiteDatabase()],
  ])('%s: a string never equals a number, and + on a string and a number raises 22G12', (_name, make) => {
    const db = make();
    expect(db.execute("RETURN '5' = 5 AS eq, '5' <> 5 AS ne")).toEqual([{ eq: false, ne: true }]);
    expect(failure(() => db.execute("RETURN 'x' + 3 AS v"))).toMatchObject({ gqlStatus: '22G12' });
    db.free();
  });

  it('a null in a property map finds nothing', () => {
    const db = new Database();
    db.execute("INSERT (:Person {name: 'Alix'})");
    expect(db.execute('MATCH (n {name: NULL}) RETURN n')).toEqual([]);
    expect(db.execute("MATCH (n:Person {name: 'Alix'}) RETURN n.name")).toEqual([{ 'n.name': 'Alix' }]);
    db.free();
  });

  it('executeRaw returns warnings: empty when none, a deprecation for a deprecated literal', () => {
    const db = new Database();
    expect(db.executeRaw('RETURN 1 AS one').warnings).toEqual([]);
    expect(db.executeRaw("RETURN ZONED DATETIME '2024-01-01T10:00:00Z' AS t").warnings).toEqual([
      expect.objectContaining({ code: '01X01', kind: 'deprecation' }),
    ]);
    db.free();
  });

  it('importRdf works in the full build; lite has no importRdf', () => {
    const db = new Database();
    const result = db.importRdf({
      triples: [
        {
          subject: 'http://ex/Alix',
          predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
          object: 'http://ex/Person',
        },
        { subject: 'http://ex/Alix', predicate: 'http://ex/name', object: { value: 'Alix' } },
      ],
    });
    expect(result).toEqual({ triples: 2 });
    expect(
      db.executeWithLanguage('SELECT ?o WHERE { <http://ex/Alix> <http://ex/name> ?o }', 'sparql'),
    ).toHaveLength(1);
    db.free();
    const lite = new LiteDatabase();
    expect((lite as unknown as Record<string, unknown>).importRdf).toBeUndefined();
    lite.free();
  });

  it('lite answers a catalog CALL and refuses a procedure the build lacks, naming the feature', () => {
    const lite = new LiteDatabase();
    lite.execute("INSERT (:Person {name: 'Alix'})");
    expect(lite.execute('CALL grafeo.labels()')).toEqual([{ label: 'Person' }]);
    expect(failure(() => lite.execute('CALL grafeo.total_triangles()'))).toMatchObject({
      message: expect.stringMatching(/GRAFEO-Q004: .*algos/),
      gqlStatus: '42000',
    });
    lite.free();
  });

  it('the full build runs the new graph procedures', () => {
    const db = new Database();
    db.execute(
      "INSERT (:Person {name: 'Alix'})-[:KNOWS]->(:Person {name: 'Gus'})-[:KNOWS]->(:Person {name: 'Bo'})" +
        "-[:KNOWS]->(:Person {name: 'Alix'})",
    );
    expect(db.execute('CALL grafeo.ktruss()')).toEqual([
      { source: 0, target: 1, truss_number: 2 },
      { source: 1, target: 2, truss_number: 2 },
      { source: 2, target: 3, truss_number: 2 },
    ]);
    expect(db.execute('CALL grafeo.total_triangles()')).toEqual([{ total_triangles: 0 }]);
    db.free();
  });
});

describe('Real WASM: 0.6.0 results', () => {
  it('a GQL number with a point is an exact decimal, read and written as { $decimal }', () => {
    const db = new Database();
    expect(db.execute('RETURN 1.5 AS d, 0.1 + 0.2 = 0.3 AS exact, 1.5e0 AS f')).toEqual([
      { d: { $decimal: '1.5' }, exact: true, f: 1.5 },
    ]);
    expect(db.executeWithParams('RETURN $d AS d', { d: { $decimal: '2.50' } })).toEqual([
      { d: { $decimal: '2.50' } },
    ]);
    db.free();
  });

  it('integer overflow and division by zero fail with their GQLSTATUS', () => {
    const db = new Database();
    const failure = (query: string) => {
      try {
        db.execute(query);
      } catch (error) {
        return error as Error & { gqlStatus?: string };
      }
      throw new Error(`${query} did not fail`);
    };
    expect(failure('RETURN 9223372036854775807 + 1 AS x')).toMatchObject({
      message: expect.stringMatching(/^GRAFEO-Q006: /),
      gqlStatus: '22003',
    });
    expect(failure('RETURN 10 / 0 AS x')).toMatchObject({ gqlStatus: '22012' });
    expect(db.nodeCount()).toBe(0);
    db.free();
  });

  it('SPARQL returns RDF/JS terms, ASK one boolean row', () => {
    const db = new Database();
    db.executeWithLanguage('INSERT DATA { <http://ex/a> <http://ex/name> "Alix"@en ; <http://ex/age> 30 }', 'sparql');
    expect(
      db.executeWithLanguage('SELECT ?o WHERE { <http://ex/a> ?p ?o } ORDER BY ?o', 'sparql'),
    ).toEqual([
      {
        o: {
          termType: 'Literal',
          value: '30',
          language: '',
          datatype: iri('http://www.w3.org/2001/XMLSchema#integer'),
        },
      },
      {
        o: {
          termType: 'Literal',
          value: 'Alix',
          language: 'en',
          datatype: iri('http://www.w3.org/1999/02/22-rdf-syntax-ns#langString'),
        },
      },
    ]);
    expect(db.executeWithLanguage('ASK { ?s ?p ?o }', 'sparql')).toEqual([{ boolean: true }]);
    expect(db.executeWithLanguage('ASK { ?s <http://ex/none> ?o }', 'sparql')).toEqual([{ boolean: false }]);
    db.free();
  });

  it('executeRaw reports its time and write counters', () => {
    const db = new Database();
    expect(db.executeRaw("INSERT (:Person {name: 'Alix'})")).toMatchObject({
      columns: [],
      rows: [],
      executionTimeMs: expect.any(Number),
      counters: { nodesCreated: 1, propertiesSet: 1, labelsAdded: 1 },
    });
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
    { language: 'graphql-rdf', query: '{ __typename }' },
    { language: 'sql', query: 'SELECT * FROM GRAPH_TABLE (MATCH (n) COLUMNS (n AS x)) AS g' },
    { language: 'sql-pgq', query: 'SELECT * FROM GRAPH_TABLE (MATCH (n) COLUMNS (n AS x)) AS g' },
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
