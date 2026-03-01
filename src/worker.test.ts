import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkerRequest, WorkerResponse } from './types';

// Mock the WASM module
vi.mock('@grafeo-db/wasm', () => import('./__mocks__/wasm'));

// Use a promise to capture async postMessage responses from the worker
let resolveResponse: ((res: WorkerResponse) => void) | null = null;
vi.stubGlobal('postMessage', (msg: WorkerResponse) => {
  if (resolveResponse) {
    resolveResponse(msg);
    resolveResponse = null;
  }
});

// Import the worker module (sets self.onmessage)
await import('./worker');

// Helper to dispatch a message and wait for the worker's postMessage response
async function send(method: string, args: unknown[] = [], id = 1): Promise<WorkerResponse> {
  const responsePromise = new Promise<WorkerResponse>((resolve) => {
    resolveResponse = resolve;
  });
  const request: WorkerRequest = { id, method, args };
  const handler = (self as unknown as { onmessage: (e: MessageEvent) => void }).onmessage;
  handler({ data: request } as MessageEvent<WorkerRequest>);
  return responsePromise;
}

describe('Worker message handler', () => {
  beforeEach(async () => {
    // Init a fresh database for each test
    const res = await send('init', [{}]);
    expect(res.result).toBe(true);
  });

  afterEach(async () => {
    await send('close');
  });

  describe('init', () => {
    it('initializes without persistence', async () => {
      const res = await send('init', [{}], 10);
      expect(res.result).toBe(true);
      expect(res.error).toBeUndefined();
      await send('close', [], 11);
    });

    it('initializes with persistence option', async () => {
      const res = await send('init', [{ persist: 'worker-test-db' }], 20);
      expect(res.result).toBe(true);
      await send('close', [], 21);
    });
  });

  describe('execute', () => {
    it('executes a plain query', async () => {
      await send('execute', ["INSERT (:Person {name: 'Alice'})"], 2);
      const res = await send('execute', ['MATCH (p:Person) RETURN p.name'], 3);
      expect(res.error).toBeUndefined();
      const rows = res.result as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
      expect(rows[0]['p.name']).toBe('Alice');
    });

    it('executes with language option', async () => {
      await send('execute', ["INSERT (:Person {name: 'Bob'})"], 2);
      const res = await send('execute', ['MATCH (p:Person) RETURN p.name', { language: 'cypher' }], 3);
      expect(res.error).toBeUndefined();
      expect(res.result).toHaveLength(1);
    });

    it('executes with params option', async () => {
      await send('execute', ["INSERT (:Person {name: 'Alice'})"], 2);
      const res = await send('execute', ['MATCH (p:Person) RETURN p.name', { params: { name: 'Alice' } }], 3);
      expect(res.error).toBeUndefined();
      expect(res.result).toHaveLength(1);
    });

    it('executes with language + params', async () => {
      await send('execute', ["INSERT (:Person {name: 'Alice'})"], 2);
      const res = await send('execute', [
        'MATCH (p:Person) RETURN p.name',
        { language: 'cypher', params: { name: 'Alice' } },
      ], 3);
      expect(res.error).toBeUndefined();
      expect(res.result).toHaveLength(1);
    });

    it('returns error when db not initialized', async () => {
      await send('close');
      const res = await send('execute', ['MATCH (n) RETURN n'], 5);
      expect(res.error).toBe('Database not initialized');
    });
  });

  describe('executeRaw', () => {
    it('executes raw query', async () => {
      await send('execute', ["INSERT (:Person {name: 'Alice'})"], 2);
      const res = await send('executeRaw', ['MATCH (p:Person) RETURN p.name'], 3);
      expect(res.error).toBeUndefined();
      const result = res.result as { columns: string[]; rows: unknown[][] };
      expect(result.columns).toContain('p.name');
      expect(result.rows).toHaveLength(1);
    });

    it('executes raw with language option', async () => {
      await send('execute', ["INSERT (:Person {name: 'Alice'})"], 2);
      const res = await send('executeRaw', ['MATCH (p:Person) RETURN p.name', { language: 'cypher' }], 3);
      expect(res.error).toBeUndefined();
      const result = res.result as { columns: string[] };
      expect(result.columns).toContain('p.name');
    });
  });

  describe('nodeCount / edgeCount', () => {
    it('returns node count', async () => {
      const res = await send('nodeCount', [], 2);
      expect(res.result).toBe(0);
    });

    it('returns edge count', async () => {
      const res = await send('edgeCount', [], 2);
      expect(res.result).toBe(0);
    });
  });

  describe('schema', () => {
    it('returns schema', async () => {
      const res = await send('schema', [], 2);
      expect(res.error).toBeUndefined();
      expect(res.result).toBeDefined();
    });
  });

  describe('export / import', () => {
    it('exports and imports snapshot', async () => {
      await send('execute', ["INSERT (:Person {name: 'Alice'})"], 2);
      const expRes = await send('export', [], 3);
      expect(expRes.error).toBeUndefined();
      const snapshot = expRes.result as { version: number; data: Uint8Array };
      expect(snapshot.version).toBe(1);

      await send('clear', [], 4);
      const countRes = await send('nodeCount', [], 5);
      expect(countRes.result).toBe(0);

      await send('import', [{ data: snapshot.data }], 6);
      const countRes2 = await send('nodeCount', [], 7);
      expect(countRes2.result).toBe(1);
    });
  });

  describe('clear', () => {
    it('clears the database', async () => {
      await send('execute', ["INSERT (:Person {name: 'Alice'})"], 2);
      await send('clear', [], 3);
      const res = await send('nodeCount', [], 4);
      expect(res.result).toBe(0);
    });
  });

  describe('storageStats', () => {
    it('returns zero stats without persistence', async () => {
      const res = await send('storageStats', [], 2);
      expect(res.result).toEqual({ bytesUsed: 0, quota: 0 });
    });
  });

  describe('text search', () => {
    it('createTextIndex succeeds', async () => {
      const res = await send('createTextIndex', ['Person', 'name'], 2);
      expect(res.error).toBeUndefined();
    });

    it('dropTextIndex returns boolean', async () => {
      const res = await send('dropTextIndex', ['Person', 'name'], 2);
      expect(res.error).toBeUndefined();
      expect(typeof res.result).toBe('boolean');
    });

    it('rebuildTextIndex succeeds', async () => {
      const res = await send('rebuildTextIndex', ['Person', 'name'], 2);
      expect(res.error).toBeUndefined();
    });

    it('textSearch returns array', async () => {
      const res = await send('textSearch', ['Person', 'name', 'Alice', 5], 2);
      expect(res.error).toBeUndefined();
      expect(Array.isArray(res.result)).toBe(true);
    });

    it('hybridSearch returns array', async () => {
      const res = await send('hybridSearch', ['Person', 'name', 'embedding', 'Alice', 5], 2);
      expect(res.error).toBeUndefined();
      expect(Array.isArray(res.result)).toBe(true);
    });
  });

  describe('text search with persistence', () => {
    it('createTextIndex triggers persistence path', async () => {
      await send('init', [{ persist: 'worker-persist-test' }], 50);
      const res = await send('createTextIndex', ['Person', 'name'], 51);
      expect(res.error).toBeUndefined();
      await send('close', [], 52);
    });

    it('dropTextIndex triggers persistence path', async () => {
      await send('init', [{ persist: 'worker-persist-test2' }], 60);
      const res = await send('dropTextIndex', ['Person', 'name'], 61);
      expect(res.error).toBeUndefined();
      await send('close', [], 62);
    });

    it('rebuildTextIndex triggers persistence path', async () => {
      await send('init', [{ persist: 'worker-persist-test3' }], 70);
      const res = await send('rebuildTextIndex', ['Person', 'name'], 71);
      expect(res.error).toBeUndefined();
      await send('close', [], 72);
    });
  });

  describe('close', () => {
    it('closes the database', async () => {
      const res = await send('close', [], 2);
      expect(res.error).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('returns error for unknown method', async () => {
      const res = await send('nonexistent', [], 99);
      expect(res.error).toBe('Unknown method: nonexistent');
    });

    it('returns error for invalid query', async () => {
      const res = await send('execute', ['INVALID QUERY'], 2);
      expect(res.error).toBeDefined();
    });
  });
});
