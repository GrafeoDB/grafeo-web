/**
 * Engine settings (`memoryLimit`, `pathSearchBudget`, `historyRetention`) and
 * time-travel reads through the full and lite wrappers on the real engines,
 * with IndexedDB from fake-indexeddb. Run with: npm run test:integration
 */
import { describe, expect, it } from 'vitest';

import { GrafeoDB } from '../../src/index';
import { GrafeoDB as GrafeoDBLite } from '../../src/lite';
import { PersistenceManager } from '../../src/persistence';

const MiB = 1024 * 1024;

const engineVersion = await (async () => {
  const probe = await GrafeoDB.create();
  const version = await probe.getVersion();
  await probe.close();
  return version;
})();
/** Whether the engine is `version` or later (major.minor.patch, a pre-release counts as its release). */
function engineAtLeast(version: string): boolean {
  const parts = (v: string) => v.split(/[.-]/).slice(0, 3).map(Number);
  const [have, want] = [parts(engineVersion), parts(version)];
  for (let i = 0; i < 3; i++) {
    if (have[i] !== want[i]) return have[i] > want[i];
  }
  return true;
}
/** `pathSearchBudget` is new in Grafeo 0.6.3; an older engine ignores the key. */
const hasPathSearchBudget = engineAtLeast('0.6.3');
/**
 * The engine release whose snapshot import sets the history floor at the
 * import's epoch (grafeo inbox, transactions.md: "A read before a snapshot
 * import's epoch answers with the imported data"). 0.6.2 answers such a read
 * with the imported data. Proposed for 0.6.3; move it to the release that
 * takes the fix.
 */
const HISTORY_FLOOR_AT_IMPORT = '0.6.3';

describe('memoryLimit reaches the engine', () => {
  it('memoryUsage() reports the limit set in create()', async () => {
    const db = await GrafeoDB.create({ memoryLimit: 4 * MiB });
    const usage = await db.memoryUsage();
    expect(usage.limit_bytes).toBe(4 * MiB);
    expect(usage.buffer_manager.hard_limit_bytes).toBe(4 * MiB);
    await db.close();

    const defaults = await GrafeoDB.create();
    expect((await defaults.memoryUsage()).limit_bytes).toBe(768 * MiB);
    await defaults.close();
  });
});

describe.each([
  ['full', GrafeoDB],
  ['lite', GrafeoDBLite],
] as const)('engine options on the real engine (%s)', (name, Db) => {
  it('memoryLimit holds on every path that opens a database, the persisted one included', async () => {
    const key = `it-memory-limit-${name}`;
    const big = 'x'.repeat(8 * MiB);
    const insertBig = 'INSERT (:Blob {s: $s})';

    const db = await Db.create({ persist: key, persistInterval: 10, memoryLimit: 4 * MiB });
    await db.execute("INSERT (:Person {name: 'Alix'})");
    await db.close();

    const reopened = await Db.create({ persist: key, memoryLimit: 4 * MiB });
    await expect(reopened.execute(insertBig, { params: { s: big } })).rejects.toThrow(/^GRAFEO-S001: /);
    expect(await reopened.execute('MATCH (p:Person) RETURN p.name')).toEqual([{ 'p.name': 'Alix' }]);

    await reopened.import(await reopened.export());
    await expect(reopened.execute(insertBig, { params: { s: big } })).rejects.toThrow(/^GRAFEO-S001: /);
    const key2 = new Uint8Array([7, 7, 7]);
    await reopened.signedImport(await reopened.signedExport(key2), key2);
    await expect(reopened.execute(insertBig, { params: { s: big } })).rejects.toThrow(/^GRAFEO-S001: /);
    await reopened.clear();
    await expect(reopened.execute(insertBig, { params: { s: big } })).rejects.toThrow(/^GRAFEO-S001: /);
    await reopened.close();

    // Without the setting the same write fits under the 768 MiB default.
    const unlimited = await Db.create();
    await unlimited.execute(insertBig, { params: { s: big } });
    expect(await unlimited.nodeCount()).toBe(1);
    await unlimited.close();
  });

  it('a persisted database larger than memoryLimit still opens, reads, and refuses only new writes', async () => {
    const key = `it-over-limit-${name}`;
    const db = await Db.create({ persist: key });
    await db.execute('INSERT (:Blob {s: $s})', { params: { s: 'x'.repeat(8 * MiB) } });
    await db.close();

    const small = await Db.create({ persist: key, memoryLimit: 4 * MiB });
    expect(await small.execute('MATCH (b:Blob) RETURN size(b.s) AS n')).toEqual([{ n: 8 * MiB }]);
    await expect(small.execute('INSERT (:Blob {s: $s})', { params: { s: 'y'.repeat(MiB) } })).rejects.toThrow(
      /^GRAFEO-S001: /,
    );
    expect(await new PersistenceManager(`${key}__backup`).load()).toBeNull();
    await small.clear();
    await small.close();
  });

  it('a setting the engine refuses fails create() and leaves the persisted database alone', async () => {
    const key = `it-bad-option-${name}`;
    const db = await Db.create({ persist: key });
    await db.execute("INSERT (:Person {name: 'Alix'})");
    await db.close();

    await expect(Db.create({ persist: key, memoryLimit: -5 })).rejects.toThrow(
      'memoryLimit must be a positive whole number of bytes',
    );
    await expect(Db.create({ persist: key, historyRetention: 'sometimes' as never })).rejects.toThrow(
      /historyRetention/,
    );
    expect(await new PersistenceManager(`${key}__backup`).load()).toBeNull();
    const again = await Db.create({ persist: key });
    expect(await again.nodeCount()).toBe(1);
    await again.clear();
    await again.close();
  });

  it('executeAsOf reads an earlier epoch with historyRetention', async () => {
    const db = await Db.create({ historyRetention: 'forever' });
    expect(await db.currentEpoch()).toBe(0n);
    await db.execute("INSERT (:Person {name: 'Alix'})");
    const one = await db.currentEpoch();
    await db.execute("INSERT (:Person {name: 'Gus'})");

    expect(await db.executeAsOf('MATCH (p:Person) RETURN p.name', one)).toEqual([{ 'p.name': 'Alix' }]);
    expect(
      await db.executeAsOf('MATCH (p:Person) WHERE p.name = $n RETURN p.name', { ago: 0 }, { params: { n: 'Gus' } }),
    ).toEqual([{ 'p.name': 'Gus' }]);
    expect(await db.epochAsOf(one + 100n)).toBe(one + 1n);
    await expect(db.executeAsOf("INSERT (:Person {name: 'Vincent'})", one)).rejects.toThrow(/earlier epoch/);
    await expect(db.epochAsOf(1 as never)).rejects.toThrow(TypeError);

    // Inside a transaction, a read as of now sees what is committed.
    await db.beginTransaction();
    await db.execute("INSERT (:Person {name: 'Vincent'})");
    expect(await db.executeAsOf('MATCH (p:Person) RETURN count(p) AS c', await db.currentEpoch())).toEqual([
      { c: 2 },
    ]);
    await db.rollbackTransaction();
    await db.close();
  });

  it('the README time-travel example: a read before a SET sees the old value', async () => {
    const db = await Db.create({ historyRetention: 60 * 60 * 1000 });
    await db.execute(`INSERT (:User {name: 'Alix'})`);
    const before = await db.currentEpoch();
    await db.execute(`MATCH (u:User) SET u.name = 'Gus'`);
    expect(await db.executeAsOf(`MATCH (u:User) RETURN u.name`, before)).toEqual([{ 'u.name': 'Alix' }]);
    expect(await db.executeAsOf(`MATCH (u:User) RETURN u.name`, { ago: 0 })).toEqual([{ 'u.name': 'Gus' }]);
    await db.close();
  });

  it.skipIf(!engineAtLeast(HISTORY_FLOOR_AT_IMPORT))(
    'a read before an import or a reload is refused, not answered with the imported data',
    async () => {
      const db = await Db.create({ historyRetention: 'forever' });
      await db.execute("INSERT (:P {n: 1})");
      await db.execute("INSERT (:P {n: 2})");
      await db.execute("INSERT (:P {n: 3})");
      const snapshot = await db.export();
      await db.close();

      const imported = await Db.create({ historyRetention: 'forever' });
      await imported.import(snapshot);
      expect(await imported.executeAsOf('MATCH (p:P) RETURN count(p) AS c', await imported.currentEpoch())).toEqual([
        { c: 3 },
      ]);
      await expect(imported.executeAsOf('MATCH (p:P) RETURN count(p) AS c', 1n)).rejects.toThrow(/not retained/);
      await imported.close();

      const key = `it-history-floor-${name}`;
      const persisted = await Db.create({ persist: key, historyRetention: 'forever' });
      await persisted.import(snapshot);
      await persisted.close();
      const reloaded = await Db.create({ persist: key, historyRetention: 'forever' });
      await expect(reloaded.executeAsOf('MATCH (p:P) RETURN count(p) AS c', 1n)).rejects.toThrow(/not retained/);
      await reloaded.clear();
      await reloaded.close();
    },
  );

  it('without historyRetention, an earlier epoch is refused', async () => {
    const db = await Db.create();
    await db.execute("INSERT (:Person {name: 'Alix'})");
    await db.execute("INSERT (:Person {name: 'Gus'})");
    await expect(db.executeAsOf('MATCH (p) RETURN p', 1n)).rejects.toThrow(/^GRAFEO-V001: .*not retained/);
    expect(await db.executeAsOf('MATCH (p) RETURN count(p) AS c', await db.currentEpoch())).toEqual([{ c: 2 }]);
    await db.close();
  });

  it.skipIf(!hasPathSearchBudget)('pathSearchBudget bounds a path search, also after a reload', async () => {
    const key = `it-path-budget-${name}`;
    const db = await Db.create({ persist: key, persistInterval: 10 });
    await db.execute('INSERT (:N {i: 0})-[:R]->(:N {i: 1})-[:R]->(:N {i: 2})-[:R]->(:N {i: 3})');
    const paths = 'MATCH p = (a:N {i: 0})-[:R*1..3]->(b) RETURN count(p) AS c';
    expect(await db.execute(paths)).toEqual([{ c: 3 }]);
    await db.close();

    const bounded = await Db.create({ persist: key, pathSearchBudget: 1 });
    await expect(bounded.execute(paths)).rejects.toThrow(/^GRAFEO-S001: /);
    expect(await bounded.execute('MATCH (n:N) RETURN count(n) AS c')).toEqual([{ c: 4 }]);
    await bounded.clear();
    await bounded.close();
  });
});
