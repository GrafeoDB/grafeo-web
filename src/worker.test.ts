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

  describe('compact', () => {
    it('compact succeeds', async () => {
      const res = await send('compact', [], 2);
      expect(res.error).toBeUndefined();
    });

    it('compact with persistence triggers save', async () => {
      await send('init', [{ persist: 'worker-compact-test' }], 80);
      const res = await send('compact', [], 81);
      expect(res.error).toBeUndefined();
      await send('close', [], 82);
    });
  });

  describe('snapshot migration', () => {
    it('recovers from incompatible snapshot on init', async () => {
      // First persist a snapshot
      await send('init', [{ persist: 'worker-migration-test' }], 90);
      await send('execute', ["INSERT (:Person {name: 'Alice'})"], 91);
      await send('close', [], 92);

      // Make importSnapshot throw
      const { Database } = await import('./__mocks__/wasm');
      const originalImport = Database.importSnapshot;
      Database.importSnapshot = () => {
        throw new Error('Incompatible snapshot format');
      };

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        // Should recover gracefully
        const res = await send('init', [{ persist: 'worker-migration-test' }], 93);
        expect(res.result).toBe(true);
        expect(res.error).toBeUndefined();

        // Fresh db should have 0 nodes
        const countRes = await send('nodeCount', [], 94);
        expect(countRes.result).toBe(0);

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('incompatible with this WASM version'),
          expect.any(Error),
        );

        await send('close', [], 95);
      } finally {
        Database.importSnapshot = originalImport;
        warnSpy.mockRestore();
      }
    });
  });

  describe('graph projections', () => {
    it('createProjection returns true', async () => {
      const res = await send('createProjection', ['social', ['Person'], ['KNOWS']], 2);
      expect(res.error).toBeUndefined();
      expect(res.result).toBe(true);
    });

    it('createProjection returns false for duplicate', async () => {
      await send('createProjection', ['social', ['Person'], ['KNOWS']], 2);
      const res = await send('createProjection', ['social', ['Person'], ['KNOWS']], 3);
      expect(res.result).toBe(false);
    });

    it('dropProjection returns true when existed', async () => {
      await send('createProjection', ['social', ['Person']], 2);
      const res = await send('dropProjection', ['social'], 3);
      expect(res.error).toBeUndefined();
      expect(res.result).toBe(true);
    });

    it('dropProjection returns false when not found', async () => {
      const res = await send('dropProjection', ['nonexistent'], 2);
      expect(res.result).toBe(false);
    });

    it('listProjections returns names', async () => {
      await send('createProjection', ['social', ['Person'], ['KNOWS']], 2);
      await send('createProjection', ['docs', ['Document']], 3);
      const res = await send('listProjections', [], 4);
      expect(res.error).toBeUndefined();
      expect(res.result).toContain('social');
      expect(res.result).toContain('docs');
    });

    it('createProjection triggers persistence', async () => {
      await send('init', [{ persist: 'worker-proj-create' }], 40);
      const res = await send('createProjection', ['social', ['Person']], 41);
      expect(res.error).toBeUndefined();
      expect(res.result).toBe(true);
      await send('close', [], 42);
    });

    it('dropProjection triggers persistence', async () => {
      await send('init', [{ persist: 'worker-proj-drop' }], 43);
      await send('createProjection', ['social', ['Person']], 44);
      const res = await send('dropProjection', ['social'], 45);
      expect(res.error).toBeUndefined();
      expect(res.result).toBe(true);
      await send('close', [], 46);
    });
  });

  describe('close', () => {
    it('closes the database', async () => {
      const res = await send('close', [], 2);
      expect(res.error).toBeUndefined();
    });
  });

  describe('transactions', () => {
    it('beginTransaction succeeds', async () => {
      const res = await send('beginTransaction', [], 200);
      expect(res.error).toBeUndefined();
      await send('rollbackTransaction', [], 201);
    });

    it('isTransactionActive flips with begin/commit', async () => {
      let res = await send('isTransactionActive', [], 210);
      expect(res.result).toBe(false);
      await send('beginTransaction', [], 211);
      res = await send('isTransactionActive', [], 212);
      expect(res.result).toBe(true);
      await send('commitTransaction', [], 213);
      res = await send('isTransactionActive', [], 214);
      expect(res.result).toBe(false);
    });

    it('rollback reverts mid-tx writes', async () => {
      await send('execute', ["INSERT (:Person {name: 'Alice'})"], 220);
      await send('beginTransaction', [], 221);
      await send('execute', ["INSERT (:Person {name: 'Bob'})"], 222);
      let countRes = await send('nodeCount', [], 223);
      expect(countRes.result).toBe(2);
      await send('rollbackTransaction', [], 224);
      countRes = await send('nodeCount', [], 225);
      expect(countRes.result).toBe(1);
    });

    it('commit makes writes durable', async () => {
      await send('beginTransaction', [], 230);
      await send('execute', ["INSERT (:Person {name: 'Alice'})"], 231);
      await send('commitTransaction', [], 232);
      const res = await send('nodeCount', [], 233);
      expect(res.result).toBe(1);
    });

    it('commit with persistence schedules save', async () => {
      await send('init', [{ persist: 'worker-tx-commit-persist' }], 240);
      await send('beginTransaction', [], 241);
      await send('execute', ["INSERT (:Person {name: 'Alice'})"], 242);
      const res = await send('commitTransaction', [], 243);
      expect(res.error).toBeUndefined();
      await send('close', [], 244);
    });

    it('rollback with persistence schedules save (post-rollback state must land on disk)', async () => {
      await send('init', [{ persist: 'worker-tx-rollback-persist' }], 250);
      await send('beginTransaction', [], 251);
      await send('execute', ["INSERT (:Person {name: 'Bob'})"], 252);
      const res = await send('rollbackTransaction', [], 253);
      expect(res.error).toBeUndefined();
      await send('close', [], 254);
    });

    it('begin cancels pending pre-tx save (no mid-tx persistence)', async () => {
      // Init with very short interval so the debounce would fire mid-tx if not cancelled
      await send('init', [{ persist: 'worker-tx-cancel-test', persistInterval: 10 }], 260);
      await send('execute', ["INSERT (:Person {name: 'Alice'})"], 261);
      // beginTransaction should call persistence.cancel() so the queued timer dies
      const beginRes = await send('beginTransaction', [], 262);
      expect(beginRes.error).toBeUndefined();
      // Insert mid-tx. If begin didn't cancel, the queued debounce would
      // capture mid-tx state via exportSnapshot() at fire time.
      await send('execute', ["INSERT (:Person {name: 'Bob'})"], 263);
      // Wait long enough for any uncancelled timer to fire
      await new Promise((resolve) => setTimeout(resolve, 30));

      // Inspect the persisted snapshot BEFORE rollback/close — close()'s flush
      // would otherwise overwrite any mid-tx write, masking a regression.
      // With cancel() working, no snapshot was scheduled at all (pre-tx save
      // was cancelled, mid-tx INSERT did not schedule). If cancel() regressed,
      // the t=10 timer would have written [Alice, Bob] (uncommitted state).
      const { PersistenceManager } = await import('./persistence');
      const reader = new PersistenceManager('worker-tx-cancel-test');
      const persistedDuringTx = await reader.load();
      if (persistedDuringTx) {
        const wasmModule = await import('./__mocks__/wasm');
        const restored = wasmModule.Database.importSnapshot(persistedDuringTx);
        // Anything persisted during the tx must NOT include uncommitted writes.
        expect(restored.nodeCount()).toBe(1);
        restored.free();
      }

      await send('rollbackTransaction', [], 264);
      await send('close', [], 265);
      await reader.clear();
    });

    it('execute() schedules save after import() during a tx (no stale flag leak)', async () => {
      await send('init', [{ persist: 'worker-tx-stale-import', persistInterval: 5 }], 280);
      await send('execute', ["INSERT (:Person {name: 'Alice'})"], 281);
      const expRes = await send('export', [], 282);
      const snapshot = expRes.result as { data: Uint8Array };
      await send('beginTransaction', [], 283);
      // Swap WASM mid-tx. The new DB has no active tx — subsequent writes
      // must resume scheduling save (regression test for stale-flag bug).
      await send('import', [snapshot], 284);
      await send('execute', ["INSERT (:Person {name: 'Bob'})"], 285);
      await new Promise((resolve) => setTimeout(resolve, 30));

      const { PersistenceManager } = await import('./persistence');
      const reader = new PersistenceManager('worker-tx-stale-import');
      const persisted = await reader.load();
      expect(persisted).not.toBeNull();
      const wasmModule = await import('./__mocks__/wasm');
      const restored = wasmModule.Database.importSnapshot(persisted!);
      expect(restored.nodeCount()).toBe(2);
      restored.free();

      await send('close', [], 286);
      await reader.clear();
    });

    it('returns error when db not initialized', async () => {
      await send('close', [], 270);
      const res = await send('beginTransaction', [], 271);
      expect(res.error).toBe('Database not initialized');
      const res2 = await send('commitTransaction', [], 272);
      expect(res2.error).toBe('Database not initialized');
      const res3 = await send('rollbackTransaction', [], 273);
      expect(res3.error).toBe('Database not initialized');
      const res4 = await send('isTransactionActive', [], 274);
      expect(res4.error).toBe('Database not initialized');
    });
  });

  describe('signed snapshots', () => {
    const key = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    it('signedExport returns Uint8Array prefixed with GSN1', async () => {
      await send('execute', ["INSERT (:Person {name: 'Alice'})"], 300);
      const res = await send('signedExport', [key], 301);
      expect(res.error).toBeUndefined();
      const signed = res.result as Uint8Array;
      expect(signed).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(signed.slice(0, 4))).toBe('GSN1');
    });

    it('signedExport + signedImport round-trips', async () => {
      await send('execute', ["INSERT (:Person {name: 'Alice'})"], 310);
      const expRes = await send('signedExport', [key], 311);
      const signed = expRes.result as Uint8Array;

      await send('clear', [], 312);
      const importRes = await send('signedImport', [signed, key], 313);
      expect(importRes.error).toBeUndefined();

      const countRes = await send('nodeCount', [], 314);
      expect(countRes.result).toBe(1);
    });

    it('signedImport fails on wrong key', async () => {
      await send('execute', ["INSERT (:Person {name: 'Alice'})"], 320);
      const expRes = await send('signedExport', [key], 321);
      const signed = expRes.result as Uint8Array;

      const wrongKey = new Uint8Array(key);
      wrongKey[0] ^= 0xff;
      const res = await send('signedImport', [signed, wrongKey], 322);
      expect(res.error).toBeDefined();
    });

    it('signedImport with persistence schedules save', async () => {
      await send('init', [{ persist: 'worker-signed-persist' }], 330);
      await send('execute', ["INSERT (:Person {name: 'Alice'})"], 331);
      const expRes = await send('signedExport', [key], 332);
      const signed = expRes.result as Uint8Array;
      await send('clear', [], 333);
      const importRes = await send('signedImport', [signed, key], 334);
      expect(importRes.error).toBeUndefined();
      await send('close', [], 335);
    });

    it('returns error when db not initialized', async () => {
      await send('close', [], 340);
      const res = await send('signedExport', [key], 341);
      expect(res.error).toBe('Database not initialized');
      const res2 = await send('signedImport', [new Uint8Array([0]), key], 342);
      expect(res2.error).toBe('Database not initialized');
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
