import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkerRequest, WorkerResponse } from './types';

// The worker client must not load the engine on the main thread: any import
// of either engine package from this file's module graph fails the import.
vi.mock('@grafeo-db/wasm', () => {
  throw new Error('@grafeo-db/wasm was imported on the main thread');
});
vi.mock('@grafeo-db/wasm-lite', () => {
  throw new Error('@grafeo-db/wasm-lite was imported on the main thread');
});

/** A stand-in Worker that answers every request, recording what it got. */
class FakeWorker {
  static created: FakeWorker[] = [];
  readonly url: unknown;
  readonly options: unknown;
  readonly received: WorkerRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  answer: (request: WorkerRequest) => WorkerResponse = (request) => ({
    id: request.id,
    result: request.method === 'nodeCount' ? 3 : request.method === 'init' ? true : undefined,
  });

  constructor(url?: unknown, options?: unknown) {
    this.url = url;
    this.options = options;
    FakeWorker.created.push(this);
  }

  postMessage(request: WorkerRequest): void {
    this.received.push(request);
    queueMicrotask(() => this.onmessage?.({ data: this.answer(request) } as MessageEvent<WorkerResponse>));
  }

  terminate(): void {
    this.terminated = true;
  }
}

vi.stubGlobal('Worker', FakeWorker);

const { GrafeoDB } = await import('./worker-client');

afterEach(() => {
  FakeWorker.created = [];
});

describe('@grafeo-db/web/worker-client', () => {
  it('loads without importing the engine', () => {
    expect(typeof GrafeoDB.create).toBe('function');
  });

  it('starts the package worker as a module worker and opens the database in it', async () => {
    const db = await GrafeoDB.create({ persist: 'client-db', persistInterval: 250 });
    const [worker] = FakeWorker.created;
    // dist/worker.js next to the module; vitest maps it to src/worker.ts.
    expect(String(worker.url)).toMatch(/\/worker\.(js|ts)$/);
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.received[0]).toMatchObject({
      method: 'init',
      args: [{ persist: 'client-db', persistInterval: 250 }],
    });
    await db.close();
  });

  it('uses a worker the caller passes', async () => {
    const own = new FakeWorker('custom-worker.js');
    const db = await GrafeoDB.create({ worker: own as unknown as Worker });
    expect(FakeWorker.created).toEqual([own]);
    expect(own.received[0].method).toBe('init');
    await db.close();
  });

  it('runs every call in the worker', async () => {
    const db = await GrafeoDB.create();
    const worker = FakeWorker.created[0];

    expect(await db.nodeCount()).toBe(3);
    await db.execute('MATCH (p:Person {name: $name}) RETURN p', { params: { name: 'Alix' }, language: 'gql' });
    await db.executeRaw('RETURN $x AS x', { params: { x: 1 } });
    await db.createTextIndex('Doc', 'body', { tokenizer: 'standard' });
    await db.textSearch('Doc', 'body', 'graph', 5, { filters: { city: 'Berlin' } });

    expect(worker.received.slice(1).map((r) => [r.method, r.args])).toEqual([
      ['nodeCount', []],
      ['execute', ['MATCH (p:Person {name: $name}) RETURN p', { params: { name: 'Alix' }, language: 'gql' }]],
      ['executeRaw', ['RETURN $x AS x', { params: { x: 1 } }]],
      ['createTextIndex', ['Doc', 'body', { tokenizer: 'standard' }]],
      ['textSearch', ['Doc', 'body', 'graph', 5, { filters: { city: 'Berlin' } }]],
    ]);
    await db.close();
  });

  const key = new Uint8Array([1, 2, 3]);
  const vector = new Float32Array([1, 0]);
  const forwarded: Array<[string, unknown[]]> = [
    ['edgeCount', []],
    ['schema', []],
    ['storageStats', []],
    ['export', []],
    ['import', [{ version: 1, data: new Uint8Array([4]), timestamp: 0 }]],
    ['clear', []],
    ['dropTextIndex', ['Doc', 'body']],
    ['rebuildTextIndex', ['Doc', 'body']],
    ['hybridSearch', ['Doc', 'body', 'emb', 'graph', 5, { filters: { x: 1 } }]],
    ['createVectorIndex', ['Doc', 'emb', { dimensions: 2 }]],
    ['dropVectorIndex', ['Doc', 'emb']],
    ['rebuildVectorIndex', ['Doc', 'emb']],
    ['vectorSearch', ['Doc', 'emb', vector, 3, { ef: 50 }]],
    ['mmrSearch', ['Doc', 'emb', vector, 3, { lambda: 0.5 }]],
    ['createProjection', ['social', ['Person'], ['KNOWS']]],
    ['dropProjection', ['social']],
    ['listProjections', []],
    ['setSchema', ['s1']],
    ['resetSchema', []],
    ['currentSchema', []],
    ['compact', []],
    ['clearPlanCache', []],
    ['memoryUsage', []],
    ['info', []],
    ['importRows', [[{ name: 'Alix' }], { mode: 'nodes', label: 'Person' }]],
    ['importLpg', [{ nodes: [{ labels: ['Person'] }], edges: [] }]],
    ['importRdf', [{ triples: [{ subject: 'http://a', predicate: 'http://p', object: 'http://b' }] }]],
    ['getNodeEdges', [0, { direction: 'in', edgeTypes: ['KNOWS'] }]],
    ['batchVectorSearch', ['Doc', 'emb', [vector, [0, 1]], 3, { ef: 50 }]],
    ['batchCreateNodesWithProps', [['Person'], [{ name: 'Alix' }]]],
    ['batchCreateEdges', [[{ src: 0, dst: 1, type: 'KNOWS' }]]],
    ['upsertNodes', ['File', [{ path: 'a' }], { key: 'path', replace: true }]],
    ['upsertEdges', ['IMPORTS', [{ id: 'e' }], { endpointLabels: ['File'] }]],
    ['beginTransaction', []],
    ['commitTransaction', []],
    ['rollbackTransaction', []],
    ['isTransactionActive', []],
    ['signedExport', [key]],
    ['signedImport', [new Uint8Array([9]), key]],
  ];

  // Methods typed Promise<void>: whatever the worker answers is dropped.
  const returnsNothing = new Set([
    'import', 'clear', 'rebuildTextIndex', 'createVectorIndex', 'rebuildVectorIndex', 'setSchema',
    'resetSchema', 'clearPlanCache', 'beginTransaction', 'commitTransaction', 'rollbackTransaction',
    'signedImport',
  ]);

  it.each(forwarded)('%s reaches the worker under its own name with its arguments', async (method, args) => {
    const db = await GrafeoDB.create();
    const worker = FakeWorker.created[0];
    worker.answer = (r) => ({ id: r.id, result: `answer to ${r.method}` });
    const result = await (db as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method](...args);
    const request = worker.received.at(-1)!;
    expect(request.method).toBe(method);
    // Trailing optional arguments the proxy fills in are undefined.
    expect(request.args.slice(0, args.length)).toEqual(args);
    expect(request.args.slice(args.length).every((a) => a === undefined)).toBe(true);
    expect(result).toBe(returnsNothing.has(method) ? undefined : `answer to ${method}`);
    worker.answer = (r) => ({ id: r.id });
    await db.close();
  });

  it('reports the engine version from the worker', async () => {
    const db = await GrafeoDB.create();
    FakeWorker.created[0].answer = (r) => ({ id: r.id, result: r.method === 'version' ? '0.6.0-beta.1' : true });
    expect(await db.getVersion()).toBe('0.6.0-beta.1');
    await db.close();
  });

  it('passes worker errors on, with their gqlStatus', async () => {
    const db = await GrafeoDB.create();
    FakeWorker.created[0].answer = (r) => ({
      id: r.id,
      error: 'GRAFEO-Q006: division by zero: 10 / 0',
      errorInfo: { gqlStatus: '22012' },
    });
    await expect(db.execute('RETURN 10 / 0')).rejects.toMatchObject({
      message: 'GRAFEO-Q006: division by zero: 10 / 0',
      gqlStatus: '22012',
    });
    FakeWorker.created[0].answer = (r) => ({ id: r.id });
    await db.close();
  });

  it('closes the database in the worker, stops the worker, and refuses calls after', async () => {
    const db = await GrafeoDB.create();
    const worker = FakeWorker.created[0];
    expect(db.isOpen).toBe(true);

    await db.close();
    expect(worker.received.at(-1)?.method).toBe('close');
    expect(worker.terminated).toBe(true);
    expect(db.isOpen).toBe(false);

    await expect(db.execute('MATCH (n) RETURN n')).rejects.toThrow('Database is closed');
    await expect(db.changesSince(0)).rejects.toThrow('Database is closed');
    await db.close(); // a second close is a no-op
    expect(worker.received.filter((r) => r.method === 'close')).toHaveLength(1);
  });

  it('changesSince() is not implemented', async () => {
    const db = await GrafeoDB.create();
    await expect(db.changesSince(0)).rejects.toThrow('changesSince() is not yet implemented');
    await db.close();
  });
});
