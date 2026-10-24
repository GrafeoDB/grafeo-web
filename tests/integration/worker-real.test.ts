/**
 * The worker entry (src/worker.ts) on the real @grafeo-db/wasm engine, in
 * Node with a minimal worker global scope: `self` is the global object and
 * `postMessage` collects the answers. Covers what worker mode under Vite hit:
 * the messages posted right after the worker starts, before the engine has
 * loaded, must all be answered.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import type { WorkerRequest, WorkerResponse } from '../../src/types';

const answers: WorkerResponse[] = [];
const scope = globalThis as unknown as {
  self: unknown;
  postMessage: (message: WorkerResponse) => void;
  onmessage: ((event: { data: WorkerRequest }) => void) | null;
};
scope.self = globalThis;
scope.postMessage = (message) => {
  answers.push(message);
};

let nextId = 1;
function post(method: string, ...args: unknown[]): number {
  const id = nextId++;
  scope.onmessage!({ data: { id, method, args } });
  return id;
}

async function call(method: string, ...args: unknown[]): Promise<WorkerResponse> {
  const id = post(method, ...args);
  await vi.waitFor(() => expect(answers.some((a) => a.id === id)).toBe(true));
  return answers.find((a) => a.id === id)!;
}

describe('worker entry on the real engine', () => {
  it('answers the messages posted before the engine has loaded, in order', async () => {
    await import('../../src/worker');
    // Posted in the same task as the import: the engine has not loaded yet.
    const ids = [
      post('init', undefined),
      post('execute', "INSERT (:Person {name: 'Alix'})-[:KNOWS]->(:Person {name: 'Gus'})"),
      post('execute', 'MATCH (a)-[:KNOWS]->(b) RETURN a.name, b.name'),
      post('version'),
    ];

    await vi.waitFor(() => expect(answers).toHaveLength(4), { timeout: 20000 });
    expect(answers.map((a) => a.id)).toEqual(ids);
    expect(answers.map((a) => a.error)).toEqual([undefined, undefined, undefined, undefined]);
    expect(answers[2].result).toEqual([{ 'a.name': 'Alix', 'b.name': 'Gus' }]);
    expect(answers[3].result).toMatch(/^0\.6\.0($|-)/);
    expect((await call('close')).error).toBeUndefined();
  });

  it('opens a database persisted by @grafeo-db/web 0.5.44, and persists it again', async () => {
    const key = 'it-worker-upgrade';
    const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures');
    const { PersistenceManager } = await import('../../src/persistence');
    // Same record layout as 0.5.44 wrote; see web-real.test.ts for the raw form.
    await new PersistenceManager(key).save(
      new Uint8Array(await readFile(resolve(fixtures, 'snapshot-v4-wasm-0.5.44.bin'))),
    );

    expect((await call('init', { persist: key, persistInterval: 10 })).result).toBe(true);
    expect((await call('nodeCount')).result).toBe(5);
    expect((await call('textSearch', 'Doc', 'body', 'graph', 2)).result).toEqual([
      { id: 3, score: expect.any(Number) },
    ]);
    await call('execute', "INSERT (:Person {name: 'Vincent'})");
    expect((await call('close')).error).toBeUndefined();

    expect((await call('init', { persist: key })).result).toBe(true);
    expect((await call('nodeCount')).result).toBe(6);
    expect((await call('clear')).error).toBeUndefined();
    expect((await call('close')).error).toBeUndefined();
  });

  it('refuses compact() on an engine where it panics, and keeps working', async () => {
    const { COMPACT_PANICS_IN } = await import('../../src/engine-quirks');
    await call('init', undefined);
    await call('execute', "INSERT (:Person {name: 'Alix'})");
    const version = (await call('version')).result as string;
    const compact = await call('compact');
    if (COMPACT_PANICS_IN.has(version)) {
      expect(compact.error).toContain(`compact() is not available with Grafeo ${version}`);
    } else {
      expect(compact.result).toMatchObject({ checkpointed: false });
    }
    expect((await call('nodeCount')).result).toBe(1);
    await call('close');
  });

  it('runs batch writes, upserts and getNodeEdges', async () => {
    await call('init', undefined);
    const ids = (await call('batchCreateNodesWithProps', ['Person'], [{ id: 'a' }, { id: 'g' }])).result as number[];
    expect(ids).toEqual([0, 1]);
    expect((await call('batchCreateEdges', [{ src: 0, dst: 1, type: 'KNOWS' }])).result).toEqual([0]);
    expect((await call('getNodeEdges', 1, { direction: 'in' })).result).toEqual([[0, 0]]);
    expect((await call('upsertNodes', 'Person', [{ id: 'a', age: 30 }], undefined)).result).toEqual({
      created: 0,
      updated: 1,
      skipped: 0,
      skippedRows: [],
    });
    expect((await call('upsertEdges', 'KNOWS', [{ id: 'k', src: 'g', dst: 'a' }], undefined)).result).toMatchObject({
      created: 1,
    });
    await call('close');
  });

  it('sends the GQLSTATUS of an engine error to the main thread', async () => {
    await call('init', undefined);
    const overflow = await call('execute', 'RETURN 9223372036854775807 + 1 AS x');
    expect(overflow.error).toMatch(/^GRAFEO-Q006: /);
    expect(overflow.errorInfo).toMatchObject({ gqlStatus: '22003' });
    expect((await call('execute', 'RETURN 10 / 0 AS x')).errorInfo).toMatchObject({ gqlStatus: '22012' });
    await call('close');
  });
});
