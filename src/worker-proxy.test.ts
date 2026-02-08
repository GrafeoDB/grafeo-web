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
  vi.fn(() => {
    mockWorker = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
    };
    return mockWorker;
  }),
);

// Also stub URL constructor for import.meta.url usage
vi.stubGlobal('URL', vi.fn(() => 'blob:mock'));

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

  describe('send() without init', () => {
    it('rejects if worker not initialized', async () => {
      const fresh = new WorkerProxy();
      await expect(fresh.execute('MATCH (n) RETURN n')).rejects.toThrow(
        'Worker not initialized',
      );
    });
  });
});
