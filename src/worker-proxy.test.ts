import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkerResponse } from './types';

// Mock Worker constructor
interface MockWorker {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

let mockWorker: MockWorker;

vi.stubGlobal(
  'Worker',
  vi.fn(function () {
    mockWorker = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
    };
    return mockWorker;
  }),
);

const { WorkerProxy } = await import('./worker-proxy');

/** Simulate the worker responding to the last postMessage call. */
function respondToLast(result?: unknown, error?: string): void {
  const calls = mockWorker.postMessage.mock.calls;
  const lastMsg = calls[calls.length - 1][0] as { id: number };
  const response: WorkerResponse = { id: lastMsg.id };
  if (error !== undefined) {
    response.error = error;
  } else {
    response.result = result;
  }
  mockWorker.onmessage?.({ data: response } as MessageEvent<WorkerResponse>);
}

describe('WorkerProxy', () => {
  let proxy: InstanceType<typeof WorkerProxy>;

  beforeEach(async () => {
    proxy = new WorkerProxy();

    // Start init — it sends a message and waits for response
    const initPromise = proxy.init({ persist: 'test' });

    // Respond to the init message
    respondToLast(true);
    await initPromise;
  });

  afterEach(async () => {
    // Close if still open
    try {
      const closePromise = proxy.close();
      respondToLast(undefined);
      await closePromise;
    } catch {
      // already closed
    }
  });

  describe('init()', () => {
    it('creates a Worker and sends init message', () => {
      // Worker was already created in beforeEach
      expect(Worker).toHaveBeenCalled();

      const firstCall = mockWorker.postMessage.mock.calls[0][0];
      expect(firstCall.method).toBe('init');
      expect(firstCall.args).toEqual([{ persist: 'test' }]);
    });
  });

  describe('execute()', () => {
    it('sends execute message and resolves with result', async () => {
      const mockResults = [{ 'p.name': 'Alice' }];
      const promise = proxy.execute('MATCH (p) RETURN p.name');
      respondToLast(mockResults);

      const result = await promise;
      expect(result).toEqual(mockResults);

      const lastCall =
        mockWorker.postMessage.mock.calls[
          mockWorker.postMessage.mock.calls.length - 1
        ][0];
      expect(lastCall.method).toBe('execute');
      expect(lastCall.args[0]).toBe('MATCH (p) RETURN p.name');
    });
  });

  describe('executeRaw()', () => {
    it('sends executeRaw message and resolves', async () => {
      const mockResult = {
        columns: ['p.name'],
        rows: [['Alice']],
        executionTimeMs: 1.2,
      };
      const promise = proxy.executeRaw('MATCH (p) RETURN p.name');
      respondToLast(mockResult);

      const result = await promise;
      expect(result).toEqual(mockResult);
    });
  });

  describe('nodeCount() / edgeCount()', () => {
    it('sends nodeCount message', async () => {
      const promise = proxy.nodeCount();
      respondToLast(42);
      expect(await promise).toBe(42);
    });

    it('sends edgeCount message', async () => {
      const promise = proxy.edgeCount();
      respondToLast(7);
      expect(await promise).toBe(7);
    });
  });

  describe('close()', () => {
    it('sends close message and terminates worker', async () => {
      const promise = proxy.close();
      respondToLast(undefined);
      await promise;

      expect(mockWorker.terminate).toHaveBeenCalled();
    });
  });

  describe('executeRaw() with language', () => {
    it('sends executeRaw with options', async () => {
      const mockResult = {
        columns: ['p.name'],
        rows: [['Alice']],
        executionTimeMs: 0.5,
      };
      const promise = proxy.executeRaw('MATCH (p) RETURN p.name', {
        language: 'cypher',
      });
      respondToLast(mockResult);

      const result = await promise;
      expect(result).toEqual(mockResult);

      const lastCall =
        mockWorker.postMessage.mock.calls[
          mockWorker.postMessage.mock.calls.length - 1
        ][0];
      expect(lastCall.method).toBe('executeRaw');
      expect(lastCall.args[1]).toEqual({ language: 'cypher' });
    });
  });

  describe('errors from the worker', () => {
    it('rebuilds the error name and gqlStatus', async () => {
      const promise = proxy.execute('RETURN 10 / 0');
      const calls = mockWorker.postMessage.mock.calls;
      const { id } = calls[calls.length - 1][0] as { id: number };
      mockWorker.onmessage?.({
        data: { id, error: 'GRAFEO-Q006: division by zero', errorInfo: { name: 'TypeError', gqlStatus: '22012' } },
      } as MessageEvent<WorkerResponse>);

      const err = await promise.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('GRAFEO-Q006: division by zero');
      expect((err as Error).name).toBe('TypeError');
      expect((err as Error & { gqlStatus?: string }).gqlStatus).toBe('22012');
    });
  });

  describe('text/hybrid search proxy', () => {
    it('sends createTextIndex and resolves', async () => {
      const promise = proxy.createTextIndex('Person', 'name');
      respondToLast(undefined);
      await expect(promise).resolves.toBeUndefined();

      const lastCall =
        mockWorker.postMessage.mock.calls[
          mockWorker.postMessage.mock.calls.length - 1
        ][0];
      expect(lastCall.method).toBe('createTextIndex');
      expect(lastCall.args).toEqual(['Person', 'name', undefined]);
    });

    it('sends text index options and search filters', async () => {
      const calls = mockWorker.postMessage.mock.calls;
      const create = proxy.createTextIndex('Doc', 'body', { tokenizer: 'standard' });
      respondToLast(undefined);
      await create;
      expect(calls[calls.length - 1][0].args).toEqual(['Doc', 'body', { tokenizer: 'standard' }]);

      const text = proxy.textSearch('Doc', 'body', 'graph', 5, { filters: { city: 'Berlin' } });
      respondToLast([]);
      await text;
      expect(calls[calls.length - 1][0].args).toEqual([
        'Doc', 'body', 'graph', 5, { filters: { city: 'Berlin' } },
      ]);

      const hybrid = proxy.hybridSearch('Doc', 'body', 'emb', 'graph', 5, { filters: { x: 1 } });
      respondToLast([]);
      await hybrid;
      expect(calls[calls.length - 1][0].args).toEqual([
        'Doc', 'body', 'emb', 'graph', 5, { filters: { x: 1 } },
      ]);
    });

    it('sends dropTextIndex and resolves with boolean', async () => {
      const promise = proxy.dropTextIndex('Person', 'name');
      respondToLast(true);

      const result = await promise;
      expect(result).toBe(true);
    });

    it('sends rebuildTextIndex and resolves', async () => {
      const promise = proxy.rebuildTextIndex('Person', 'name');
      respondToLast(undefined);
      await expect(promise).resolves.toBeUndefined();
    });

    it('sends textSearch and resolves with results', async () => {
      const mockResults = [{ id: 1, score: 0.95 }];
      const promise = proxy.textSearch('Person', 'name', 'Alice', 5);
      respondToLast(mockResults);

      const result = await promise;
      expect(result).toEqual(mockResults);
    });

    it('sends hybridSearch and resolves with results', async () => {
      const mockResults = [{ id: 2, score: 0.87 }];
      const promise = proxy.hybridSearch('Person', 'name', 'embedding', 'Alice', 5);
      respondToLast(mockResults);

      const result = await promise;
      expect(result).toEqual(mockResults);
    });
  });

  describe('error handling', () => {
    it('rejects when worker responds with error', async () => {
      const promise = proxy.execute('BAD QUERY');
      respondToLast(undefined, 'Parse error');

      await expect(promise).rejects.toThrow('Parse error');
    });

    it('rejects all pending on worker onerror', async () => {
      const p1 = proxy.execute('QUERY 1');
      const p2 = proxy.nodeCount();

      // Simulate worker crash
      mockWorker.onerror?.({
        message: 'Worker crashed',
      } as ErrorEvent);

      await expect(p1).rejects.toThrow('Worker crashed');
      await expect(p2).rejects.toThrow('Worker crashed');
    });
  });

  describe('engine options and time travel', () => {
    it('sends the engine options with init, and only clonable ones', async () => {
      const fresh = new WorkerProxy();
      const init = fresh.init({
        persist: 'p',
        memoryLimit: 1024,
        pathSearchBudget: 512,
        historyRetention: 60_000,
        onPersistError: () => {},
      });
      const sent = mockWorker.postMessage.mock.calls.at(-1)![0] as { method: string; args: unknown[] };
      expect(sent.method).toBe('init');
      expect(sent.args[0]).toEqual({
        persist: 'p',
        persistInterval: undefined,
        memoryLimit: 1024,
        pathSearchBudget: 512,
        historyRetention: 60_000,
      });
      respondToLast(true);
      await init;
      // mockWorker is now the fresh proxy's worker: let afterEach close that one.
      proxy = fresh;
    });

    it('stops the worker it started when init fails', async () => {
      const keep = mockWorker;
      const fresh = new WorkerProxy();
      const init = fresh.init({ memoryLimit: 0 });
      const started = mockWorker;
      respondToLast(undefined, 'memoryLimit must be a positive whole number of bytes');
      await expect(init).rejects.toThrow('memoryLimit must be a positive whole number of bytes');
      expect(started.terminate).toHaveBeenCalledOnce();
      await expect(fresh.nodeCount()).rejects.toThrow('Worker not initialized');
      mockWorker = keep;
    });

    it('leaves a worker the caller passed in running when init fails', async () => {
      const keep = mockWorker;
      const own = new (globalThis as unknown as { Worker: new () => MockWorker }).Worker();
      // init() takes `options.worker instanceof Worker`: the stub's instances are plain objects.
      Object.setPrototypeOf(own, (globalThis as unknown as { Worker: { prototype: object } }).Worker.prototype);
      const fresh = new WorkerProxy();
      const init = fresh.init({ worker: own as unknown as Worker, memoryLimit: 0 });
      respondToLast(undefined, 'memoryLimit must be a positive whole number of bytes');
      await expect(init).rejects.toThrow(/memoryLimit/);
      expect(own.terminate).not.toHaveBeenCalled();
      mockWorker = keep;
    });

    it('forwards executeAsOf, epochAsOf and currentEpoch', async () => {
      const at = new Date(0);
      const rows = proxy.executeAsOf('MATCH (n) RETURN n', at, { params: { a: 1 } });
      expect(mockWorker.postMessage.mock.calls.at(-1)![0]).toMatchObject({
        method: 'executeAsOf',
        args: ['MATCH (n) RETURN n', at, { params: { a: 1 } }],
      });
      respondToLast([{ n: 1 }]);
      expect(await rows).toEqual([{ n: 1 }]);

      const epoch = proxy.epochAsOf({ ago: 5 });
      expect(mockWorker.postMessage.mock.calls.at(-1)![0]).toMatchObject({ method: 'epochAsOf', args: [{ ago: 5 }] });
      respondToLast(3n);
      expect(await epoch).toBe(3n);

      const current = proxy.currentEpoch();
      expect(mockWorker.postMessage.mock.calls.at(-1)![0]).toMatchObject({ method: 'currentEpoch', args: [] });
      respondToLast(4n);
      expect(await current).toBe(4n);
    });
  });

  describe('send() without init', () => {
    it('rejects if worker not initialized', async () => {
      const fresh = new WorkerProxy();
      await expect(fresh.execute('MATCH (n) RETURN n')).rejects.toThrow(
        'Worker not initialized',
      );
    });
  });
});
