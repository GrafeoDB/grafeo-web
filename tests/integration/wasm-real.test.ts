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
    expect(version).toMatch(/^0\.6\.0($|-)/);
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

  it('schema lists edge types with their counts', () => {
    const db = new Database();
    db.execute("INSERT (:Person {name: 'Alix'})-[:KNOWS]->(:Person {name: 'Gus'})");
    expect((db.schema() as { edge_types: unknown }).edge_types).toEqual([{ name: 'KNOWS', count: 1 }]);
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
