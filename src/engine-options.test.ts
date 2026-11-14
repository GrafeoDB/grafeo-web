import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Database as MockDatabase } from './__mocks__/wasm';
import { engineOptionsOf } from './engine-options';
import { PersistenceManager } from './persistence';
import type { CreateOptions } from './types';

vi.mock('@grafeo-db/wasm', () => import('./__mocks__/wasm'));
vi.mock('@grafeo-db/wasm-lite', () => import('./__mocks__/wasm'));

const { GrafeoDB } = await import('./index');
const { GrafeoDB: GrafeoDBLite } = await import('./lite');

type Opened = { wasm: MockDatabase };
const engineOf = (db: unknown) => (db as Opened).wasm;

let keyCounter = 0;
const freshKey = () => `engine-options-${++keyCounter}-${Date.now()}`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('engineOptionsOf', () => {
  it('keeps only the engine settings that are set', () => {
    const withPersistence: CreateOptions = { memoryLimit: 1024, persist: 'x', historyRetention: 'forever' };
    expect(engineOptionsOf(withPersistence)).toEqual({
      memoryLimit: 1024,
      historyRetention: 'forever',
    });
    expect(engineOptionsOf({ pathSearchBudget: 64 })).toEqual({ pathSearchBudget: 64 });
  });

  it('is undefined when none is set', () => {
    expect(engineOptionsOf()).toBeUndefined();
    const persistOnly: CreateOptions = { persist: 'x' };
    expect(engineOptionsOf(persistOnly)).toBeUndefined();
    expect(engineOptionsOf({ memoryLimit: undefined })).toBeUndefined();
  });
});

describe.each([
  ['full', GrafeoDB],
  ['lite', GrafeoDBLite],
] as const)('engine options (%s build)', (_name, Db) => {
  const options = { memoryLimit: 64 * 1024 * 1024, pathSearchBudget: 1024 * 1024, historyRetention: 'forever' as const };

  it('opens an in-memory database with them', async () => {
    const db = await Db.create(options);
    expect(engineOf(db).openOptions).toEqual(options);
    await db.close();
  });

  it('opens with the engine defaults when none is given', async () => {
    const db = await Db.create();
    expect(engineOf(db).openOptions).toEqual({});
    await db.close();
  });

  it('a refused setting makes create() throw', async () => {
    await expect(Db.create({ memoryLimit: -1 })).rejects.toThrow('memoryLimit must be a positive whole number of bytes');
    await expect(Db.create({ pathSearchBudget: 1.5 })).rejects.toThrow(
      'pathSearchBudget must be a positive whole number of bytes',
    );
  });

  it('reopens a persisted database with the settings given to create()', async () => {
    const key = freshKey();
    const first = await Db.create({ persist: key });
    await first.execute("INSERT (:Person {name: 'Alix'})");
    await first.close();

    const importSnapshot = vi.spyOn(MockDatabase, 'importSnapshot');
    const again = await Db.create({ persist: key, ...options });
    expect(importSnapshot).toHaveBeenCalledWith(expect.any(Uint8Array), options);
    expect(engineOf(again).openOptions).toEqual(options);
    expect(await again.nodeCount()).toBe(1);
    await again.close();
  });

  it('a refused setting leaves a persisted database where it is', async () => {
    const key = freshKey();
    const first = await Db.create({ persist: key });
    await first.execute("INSERT (:Person {name: 'Alix'})");
    await first.close();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(Db.create({ persist: key, memoryLimit: 0 })).rejects.toThrow(/memoryLimit/);

    expect(warn).not.toHaveBeenCalled();
    expect(await new PersistenceManager(`${key}__backup`).load()).toBeNull();
    const again = await Db.create({ persist: key });
    expect(await again.nodeCount()).toBe(1);
    await again.close();
  });

  it('a clear() that cannot open the fresh database keeps the old one', async () => {
    const db = await Db.create(options);
    await db.execute("INSERT (:Person {name: 'Alix'})");
    const old = engineOf(db);
    MockDatabase.failNextOpen(new Error('out of memory'));
    await expect(db.clear()).rejects.toThrow('out of memory');
    expect(engineOf(db)).toBe(old);
    expect(await db.nodeCount()).toBe(1);
    await db.close();
  });

  it('clear(), import() and signedImport() keep the settings', async () => {
    const db = await Db.create(options);
    await db.execute("INSERT (:Person {name: 'Alix'})");
    const snapshot = await db.export();
    const key = new Uint8Array([1, 2, 3]);
    const signed = await db.signedExport(key);

    await db.clear();
    expect(engineOf(db).openOptions).toEqual(options);
    await db.import(snapshot);
    expect(engineOf(db).openOptions).toEqual(options);
    await db.signedImport(signed, key);
    expect(engineOf(db).openOptions).toEqual(options);
    expect(await db.nodeCount()).toBe(1);
    await db.close();
  });
});

describe.each([
  ['full', GrafeoDB],
  ['lite', GrafeoDBLite],
] as const)('time travel (%s build)', (_name, Db) => {
  it('executeAsOf reads an earlier epoch', async () => {
    const db = await Db.create({ historyRetention: 'forever' });
    await db.execute("INSERT (:Person {name: 'Alix'})");
    const before = await db.currentEpoch();
    await db.execute("INSERT (:Person {name: 'Gus'})");

    expect(typeof before).toBe('bigint');
    expect(await db.currentEpoch()).toBe(before + 1n);
    expect(await db.executeAsOf('MATCH (p:Person) RETURN p.name', before)).toEqual([{ 'p.name': 'Alix' }]);
    expect(await db.execute('MATCH (p:Person) RETURN p.name')).toHaveLength(2);
    await db.close();
  });

  it('executeAsOf passes its parameters', async () => {
    const db = await Db.create({ historyRetention: 'forever' });
    await db.execute("INSERT (:Person {name: 'Alix'})");
    const spy = vi.spyOn(engineOf(db), 'executeAsOf');
    await db.executeAsOf('MATCH (p:Person) WHERE p.name = $name RETURN p.name', { ago: 0 }, { params: { name: 'Alix' } });
    expect(spy).toHaveBeenCalledWith(expect.any(String), { ago: 0 }, { name: 'Alix' });
    await db.close();
  });

  it('epochAsOf names the epoch a point reads at', async () => {
    const db = await Db.create({ historyRetention: 'forever' });
    await db.execute("INSERT (:Person {name: 'Alix'})");
    const now = await db.currentEpoch();
    expect(await db.epochAsOf(now + 10n)).toBe(now);
    expect(await db.epochAsOf(new Date())).toBe(now);
    await expect(db.epochAsOf(5 as never)).rejects.toThrow(TypeError);
    await db.close();
  });

  it('without history, an earlier epoch is refused', async () => {
    const db = await Db.create();
    await db.execute("INSERT (:Person {name: 'Alix'})");
    await db.execute("INSERT (:Person {name: 'Gus'})");
    await expect(db.executeAsOf('MATCH (p) RETURN p', 0n)).rejects.toThrow(/before the history/);
    await db.close();
  });

  it('a closed database refuses the calls', async () => {
    const db = await Db.create();
    await db.close();
    await expect(db.currentEpoch()).rejects.toThrow('Database is closed');
    await expect(db.epochAsOf(0n)).rejects.toThrow('Database is closed');
    await expect(db.executeAsOf('RETURN 1', 0n)).rejects.toThrow('Database is closed');
  });
});
