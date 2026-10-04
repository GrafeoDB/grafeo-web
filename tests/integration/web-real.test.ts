/**
 * Integration tests for the GrafeoDB wrappers (full and lite) on the real
 * @grafeo-db/wasm and @grafeo-db/wasm-lite binaries, with IndexedDB provided
 * by fake-indexeddb. Run with: npm run test:integration
 */
import { describe, expect, it } from 'vitest';

import { GrafeoDB } from '../../src/index';
import { GrafeoDB as GrafeoDBLite } from '../../src/lite';

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

  // 0.5.44: direct writes are checked like INSERT.
  it('importRows rejects a UNIQUE violation, keeps earlier rows and stays usable', async () => {
    const db = await GrafeoDB.create();
    await db.execute('CREATE CONSTRAINT FOR (p:Person) ON (p.email) UNIQUE');

    await expect(
      db.importRows([{ email: 'a@x' }, { email: 'a@x' }], { mode: 'nodes', label: 'Person' }),
    ).rejects.toThrow(/rows\[1\].*UNIQUE constraint violation/);
    expect(await db.nodeCount()).toBe(1);

    await db.execute("INSERT (:Person {email: 'b@x'})");
    expect(await db.nodeCount()).toBe(2);
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

describe('GrafeoDB lite on real wasm-lite', () => {
  it('runs GQL and reports its version', async () => {
    const db = await GrafeoDBLite.create();
    expect((await db.info()).version).toMatch(/^0\.5\./);
    await db.execute("INSERT (:Person {name: 'Alix'})-[:KNOWS]->(:Person {name: 'Gus'})");
    expect(await db.execute('MATCH (a)-[:KNOWS]->(b) RETURN a.name, b.name')).toEqual([
      { 'a.name': 'Alix', 'b.name': 'Gus' },
    ]);
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
