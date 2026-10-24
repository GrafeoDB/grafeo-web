/**
 * Integration tests for the GrafeoDB wrappers (full and lite) on the real
 * @grafeo-db/wasm and @grafeo-db/wasm-lite binaries, with IndexedDB provided
 * by fake-indexeddb. Run with: npm run test:integration
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { GrafeoDB } from '../../src/index';
import { GrafeoDB as GrafeoDBLite } from '../../src/lite';
import { PersistenceManager } from '../../src/persistence';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures');
const fixture = async (name: string) => new Uint8Array(await readFile(resolve(fixtures, name)));

/**
 * Writes a snapshot into IndexedDB exactly as @grafeo-db/web 0.5.44 stored it:
 * database `grafeo-web` version 1, object store `snapshots` keyed by `key`,
 * records `{ key, snapshot, timestamp }`. Raw IndexedDB calls on purpose, so
 * the test does not depend on this release's PersistenceManager.
 */
function persistAs0544(key: string, snapshot: Uint8Array): Promise<void> {
  return new Promise((done, fail) => {
    const open = indexedDB.open('grafeo-web', 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains('snapshots')) {
        open.result.createObjectStore('snapshots', { keyPath: 'key' });
      }
    };
    open.onerror = () => fail(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('snapshots', 'readwrite');
      tx.objectStore('snapshots').put({ key, snapshot, timestamp: Date.UTC(2026, 9, 4) });
      tx.oncomplete = () => {
        open.result.close();
        done();
      };
      tx.onerror = () => fail(tx.error);
    };
  });
}

/** The snapshot stored under `key`, read the way 0.5.44 reads it. */
async function storedSnapshot(key: string): Promise<Uint8Array | null> {
  return new PersistenceManager(key).load();
}

describe('GrafeoDB on real WASM', () => {
  it('persists to IndexedDB and reloads on the next create()', async () => {
    const db = await GrafeoDB.create({ persist: 'it-full-roundtrip' });
    await db.execute("INSERT (:Person {name: 'Alix'})-[:KNOWS]->(:Person {name: 'Gus'})");
    await db.close();

    const reopened = await GrafeoDB.create({ persist: 'it-full-roundtrip' });
    expect(await reopened.nodeCount()).toBe(2);
    expect(await reopened.execute('MATCH (a)-[:KNOWS]->(b) RETURN a.name, b.name')).toEqual([
      { 'a.name': 'Alix', 'b.name': 'Gus' },
    ]);
    await reopened.clear();
    await reopened.close();
  });

  it('round-trips through export() and import()', async () => {
    const source = await GrafeoDB.create();
    await source.execute("INSERT (:Person {name: 'Alix', age: 30})");
    const snapshot = await source.export();
    await source.close();

    const target = await GrafeoDB.create();
    await target.import(snapshot);
    expect(await target.execute('MATCH (p:Person) RETURN p.name, p.age')).toEqual([
      { 'p.name': 'Alix', 'p.age': 30 },
    ]);
    await target.close();
  });

  it('round-trips signed snapshots and rejects the wrong key', async () => {
    const key = new Uint8Array(32).fill(9);
    const source = await GrafeoDB.create();
    await source.execute("INSERT (:Person {name: 'Alix'})");
    const signed = await source.signedExport(key);
    await source.close();

    const target = await GrafeoDB.create();
    const wrongKey = new Uint8Array(32).fill(8);
    await expect(target.signedImport(signed, wrongKey)).rejects.toThrow();
    await target.signedImport(signed, key);
    expect(await target.nodeCount()).toBe(1);
    await target.close();
  });

  // 0.5.44: direct writes are checked like INSERT. 0.6.0: all or nothing.
  it('importRows rejects a UNIQUE violation, writes nothing and stays usable', async () => {
    const db = await GrafeoDB.create();
    await db.execute('CREATE CONSTRAINT FOR (p:Person) ON (p.email) UNIQUE');

    await expect(
      db.importRows([{ email: 'a@x' }, { email: 'a@x' }], { mode: 'nodes', label: 'Person' }),
    ).rejects.toThrow(/rows\[1\].*UNIQUE constraint violation/);
    expect(await db.nodeCount()).toBe(0);

    await db.execute("INSERT (:Person {email: 'b@x'})");
    expect(await db.nodeCount()).toBe(1);
    await db.close();
  });

  it('commits and rolls back explicit transactions', async () => {
    const db = await GrafeoDB.create();

    await db.beginTransaction();
    await db.execute("INSERT (:Person {name: 'Alix'})");
    await db.rollbackTransaction();
    expect(await db.nodeCount()).toBe(0);

    await db.beginTransaction();
    await db.execute("INSERT (:Person {name: 'Gus'})");
    await db.commitTransaction();
    expect(await db.isTransactionActive()).toBe(false);
    expect(await db.nodeCount()).toBe(1);
    await db.close();
  });

  // 0.5.44: a failed statement inside a transaction is undone and the
  // transaction goes on.
  it('keeps a transaction going after a failed statement', async () => {
    const db = await GrafeoDB.create();
    await db.execute('CREATE CONSTRAINT FOR (p:Person) ON (p.email) UNIQUE');

    await db.beginTransaction();
    await db.execute("INSERT (:Person {email: 'a@x'})");
    await expect(db.execute("INSERT (:Person {email: 'a@x'})")).rejects.toThrow(/UNIQUE/);
    expect(await db.isTransactionActive()).toBe(true);
    await db.execute("INSERT (:Person {email: 'b@x'})");
    await db.commitTransaction();

    expect(await db.execute('MATCH (p:Person) RETURN p.email ORDER BY p.email')).toEqual([
      { 'p.email': 'a@x' },
      { 'p.email': 'b@x' },
    ]);
    await db.close();
  });
});

describe('upgrade: databases persisted by @grafeo-db/web 0.5.44', () => {
  it('full: opens a v4 database from IndexedDB, keeps its data and indexes, and saves it again', async () => {
    const key = 'it-upgrade-0544';
    await persistAs0544(key, await fixture('snapshot-v4-wasm-0.5.44.bin'));

    const db = await GrafeoDB.create({ persist: key, persistInterval: 10 });
    expect(await db.nodeCount()).toBe(5);
    expect(await db.execute('MATCH (a:Person)-[k:KNOWS]->(b) RETURN a.name, k.since, b.name')).toEqual([
      { 'a.name': 'Alix', 'k.since': 2020, 'b.name': 'Gus' },
    ]);
    expect((await db.textSearch('Doc', 'body', 'graph', 2)).map((r) => r.id)).toEqual([3]);
    expect((await db.vectorSearch('Doc', 'emb', new Float32Array([1, 0, 0]), 1)).map((r) => r.id)).toEqual([3]);
    expect(await db.execute('SELECT ?o WHERE { <http://ex/a> <http://ex/knows> ?o }', { language: 'sparql' })).toEqual([
      { o: { termType: 'NamedNode', value: 'http://ex/b' } },
    ]);

    await db.execute("INSERT (:Person {name: 'Vincent', age: 41})");
    await db.close();

    // Saved in the format this engine writes, and it loads again.
    const fresh = await GrafeoDB.create();
    const nativeFormat = (await fresh.export()).data[0];
    await fresh.close();
    expect((await storedSnapshot(key))![0]).toBe(nativeFormat);
    const reopened = await GrafeoDB.create({ persist: key });
    expect(await reopened.nodeCount()).toBe(6);
    expect((await reopened.textSearch('Doc', 'body', 'graph', 2)).map((r) => r.id)).toEqual([3]);
    expect(await storedSnapshot(`${key}__backup`)).toBeNull();
    await reopened.clear();
    await reopened.close();
  });

  it('full: opens the v4 database exported by wasm 0.5.42', async () => {
    const key = 'it-upgrade-0542';
    await persistAs0544(key, await fixture('snapshot-v4-wasm-0.5.42.bin'));
    const db = await GrafeoDB.create({ persist: key });
    expect(await db.nodeCount()).toBe(3);
    expect(await db.edgeCount()).toBe(1);
    await db.clear();
    await db.close();
  });

  it('lite: opens a v4 database written by the 0.5.44 lite build', async () => {
    const key = 'it-upgrade-lite-0544';
    await persistAs0544(key, await fixture('snapshot-v4-wasm-lite-0.5.44.bin'));
    const db = await GrafeoDBLite.create({ persist: key });
    expect(await db.nodeCount()).toBe(3);
    expect(await db.execute("MATCH (p:Person {name: 'Alix'})-[:KNOWS]->(b) RETURN b.name")).toEqual([
      { 'b.name': 'Gus' },
    ]);
    await db.clear();
    await db.close();
  });

  // A lite database never holds RDF or AI indexes, but a full-build snapshot
  // imported into lite under 0.5.x did (0.5.x dropped that data silently).
  // 0.6 refuses such a snapshot: it is kept under <key>__backup, not lost.
  it('lite: keeps a snapshot it cannot read under __backup and starts fresh', async () => {
    const key = 'it-upgrade-lite-refused';
    const original = await fixture('snapshot-v4-wasm-0.5.44.bin');
    await persistAs0544(key, original);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const db = await GrafeoDBLite.create({ persist: key });
      expect(await db.nodeCount()).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/"it-upgrade-lite-refused" \(snapshot format v4\) is incompatible .*Grafeo 0\.6\.0/),
        expect.objectContaining({ message: expect.stringContaining('GRAFEO-V001') }),
      );
      expect(await storedSnapshot(`${key}__backup`)).toEqual(original);
      expect(await storedSnapshot(key)).toBeNull();
      await db.close();
    } finally {
      warn.mockRestore();
      await new PersistenceManager(`${key}__backup`).clear();
    }
  });
});

describe('0.6 engine through the wrapper', () => {
  it('executeRaw() binds parameters', async () => {
    const db = await GrafeoDB.create();
    expect(await db.executeRaw('RETURN $tags AS tags', { params: { tags: ['a', 'b'] } })).toMatchObject({
      columns: ['tags'],
      rows: [[['a', 'b']]],
    });
    expect(
      await db.executeRaw('RETURN $n AS n', { language: 'cypher', params: { n: 3 } }),
    ).toMatchObject({ columns: ['n'], rows: [[3]] });
    expect(await db.executeRaw("INSERT (:Person {name: 'Alix'})")).toMatchObject({
      executionTimeMs: expect.any(Number),
      counters: { nodesCreated: 1 },
    });
    await db.close();
  });

  it('exact decimals and arithmetic errors with their GQLSTATUS', async () => {
    const db = await GrafeoDB.create();
    expect(await db.execute('RETURN 0.1 + 0.2 AS d', { params: {} })).toEqual([{ d: { $decimal: '0.3' } }]);
    expect(await db.execute('RETURN $d AS d', { params: { d: { $decimal: '1.50' } } })).toEqual([
      { d: { $decimal: '1.50' } },
    ]);
    await expect(db.execute('RETURN 9223372036854775807 + 1 AS x')).rejects.toMatchObject({ gqlStatus: '22003' });
    await expect(db.execute('RETURN 10 / 0 AS x')).rejects.toMatchObject({ gqlStatus: '22012' });
    await db.close();
  });

  it('text index options and search filters', async () => {
    const db = await GrafeoDB.create();
    await db.execute("INSERT (:Doc {body: 'graph databases', city: 'Berlin'})");
    await db.execute("INSERT (:Doc {body: 'graph theory', city: 'Utrecht'})");
    await db.createTextIndex('Doc', 'body', { tokenizer: 'standard', k1: 1.5 });
    expect(await db.textSearch('Doc', 'body', 'graph', 5)).toHaveLength(2);
    const berlin = await db.textSearch('Doc', 'body', 'graph', 5, { filters: { city: 'Berlin' } });
    expect(berlin.map((r) => r.id)).toEqual([0]);
    await db.close();
  });

  it('accepts graphql-rdf and sql-pgq as languages', async () => {
    const db = await GrafeoDB.create();
    await expect(db.execute('{ __typename }', { language: 'graphql-rdf' })).resolves.toEqual([]);
    await db.execute("INSERT (:Person {name: 'Alix'})");
    await expect(
      db.execute('SELECT * FROM GRAPH_TABLE (MATCH (p:Person) COLUMNS (p.name AS name)) AS g', {
        language: 'sql-pgq',
      }),
    ).resolves.toEqual([{ name: 'Alix' }]);
    await db.close();
  });

  it('schema() lists edge types with counts', async () => {
    const db = await GrafeoDB.create();
    await db.execute("INSERT (:Person {name: 'Alix'})-[:KNOWS]->(:Person {name: 'Gus'})");
    expect((await db.schema()).edge_types).toEqual([{ name: 'KNOWS', count: 1 }]);
    await db.close();
  });

  it('batch writes, getNodeEdges and upserts, and the saves they schedule', async () => {
    const key = 'it-direct-api';
    const db = await GrafeoDB.create({ persist: key, persistInterval: 10 });
    const [alix, gus] = await db.batchCreateNodesWithProps('Person', [
      { id: 'a', name: 'Alix' },
      { id: 'g', name: 'Gus' },
    ]);
    const [knows] = await db.batchCreateEdges([{ src: alix, dst: gus, type: 'KNOWS', properties: { since: 2020 } }]);
    // All or nothing: the second edge names a missing node, so neither is created.
    await expect(
      db.batchCreateEdges([
        { src: gus, dst: alix, type: 'KNOWS' },
        { src: gus, dst: 999, type: 'KNOWS' },
      ]),
    ).rejects.toThrow(/GRAFEO-V002: Node not found: 999/);
    expect(await db.getNodeEdges(alix)).toEqual([[gus, knows]]);
    expect(await db.getNodeEdges(alix, { direction: 'in' })).toEqual([]);
    expect(await db.getNodeEdges(gus, { direction: 'both', edgeTypes: ['LIKES'] })).toEqual([]);

    expect(
      await db.upsertNodes('Person', [{ id: 'a', age: 30 }, { id: 'v', name: 'Vincent' }, { name: 'no key' }]),
    ).toEqual({ created: 1, updated: 1, skipped: 1, skippedRows: [2] });
    expect(
      await db.upsertEdges(
        'LIKES',
        [{ id: 'l1', src: 'a', dst: 'v' }, { id: 'l2', src: 'a', dst: 'nobody' }],
        { endpointLabels: ['Person'] },
      ),
    ).toEqual({ created: 1, updated: 0, skipped: 1, skippedRows: [1] });

    await db.beginTransaction();
    await expect(db.batchCreateNodesWithProps('Person', [{}])).rejects.toThrow(/commits on its own/);
    await db.rollbackTransaction();
    await db.close();

    const reopened = await GrafeoDB.create({ persist: key });
    expect(await reopened.execute('MATCH (p:Person {id: $id}) RETURN p.name, p.age', { params: { id: 'a' } })).toEqual([
      { 'p.name': 'Alix', 'p.age': 30 },
    ]);
    expect(await reopened.edgeCount()).toBe(2);
    await reopened.clear();
    await reopened.close();
  });

  it('batchVectorSearch returns one result list per query', async () => {
    const db = await GrafeoDB.create();
    await db.execute('INSERT (:Doc {emb: vector([1.0, 0.0])}), (:Doc {emb: vector([0.0, 1.0])})');
    await db.createVectorIndex('Doc', 'emb', { dimensions: 2 });
    const results = await db.batchVectorSearch('Doc', 'emb', [new Float32Array([1, 0]), [0, 1]], 1);
    expect(results).toEqual([[{ id: 0, distance: expect.any(Number) }], [{ id: 1, distance: expect.any(Number) }]]);
    await db.close();
  });

  it('executeRaw reports the kind of result', async () => {
    const db = await GrafeoDB.create();
    expect((await db.executeRaw('RETURN 1 AS x')).kind).toBe('rows');
    expect((await db.executeRaw('ASK { ?s ?p ?o }', { language: 'sparql' })).kind).toBe('boolean');
    await db.close();
  });

  it('compact() works, or is refused without breaking the database', async () => {
    for (const db of [await GrafeoDB.create(), await GrafeoDBLite.create()]) {
      await db.execute("INSERT (:Person {name: 'Alix'})");
      const version = (await db.info()).version;
      const outcome = await db.compact().then(
        (report) => ({ report }),
        (error: Error) => ({ error }),
      );
      if ('error' in outcome) {
        expect(outcome.error.message).toContain(`compact() is not available with Grafeo ${version}`);
      } else {
        expect(outcome.report).toMatchObject({ checkpointed: false });
      }
      expect(await db.nodeCount()).toBe(1);
      await db.close();
    }
  });
});

describe('GrafeoDB lite on real wasm-lite', () => {
  it('runs GQL and reports its version', async () => {
    const db = await GrafeoDBLite.create();
    expect((await db.info()).version).toMatch(/^0\.6\.0($|-)/);
    await db.execute("INSERT (:Person {name: 'Alix'})-[:KNOWS]->(:Person {name: 'Gus'})");
    expect(await db.execute('MATCH (a)-[:KNOWS]->(b) RETURN a.name, b.name')).toEqual([
      { 'a.name': 'Alix', 'b.name': 'Gus' },
    ]);
    await db.close();
  });

  it('getNodeEdges lists a node edges', async () => {
    const db = await GrafeoDBLite.create();
    await db.execute("INSERT (:Person {name: 'Alix'})-[:KNOWS]->(:Person {name: 'Gus'})");
    expect(await db.getNodeEdges(0)).toEqual([[1, 0]]);
    expect(await db.getNodeEdges(1, { direction: 'in', edgeTypes: ['KNOWS'] })).toEqual([[0, 0]]);
    await db.close();
  });

  it('persists to IndexedDB and reloads on the next create()', async () => {
    const db = await GrafeoDBLite.create({ persist: 'it-lite-roundtrip' });
    await db.execute("INSERT (:Person {name: 'Alix'})");
    await db.close();

    const reopened = await GrafeoDBLite.create({ persist: 'it-lite-roundtrip' });
    expect(await reopened.nodeCount()).toBe(1);
    await reopened.clear();
    await reopened.close();
  });

  it('round-trips through export() and import()', async () => {
    const source = await GrafeoDBLite.create();
    await source.execute("INSERT (:Person {name: 'Alix'})");
    const snapshot = await source.export();
    await source.close();

    const target = await GrafeoDBLite.create();
    await target.import(snapshot);
    expect(await target.nodeCount()).toBe(1);
    await target.close();
  });
});
