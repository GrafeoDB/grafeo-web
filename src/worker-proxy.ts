import type {
  CreateOptions,
  DatabaseSnapshot,
  ExecuteOptions,
  RawQueryResult,
  StorageStats,
  WorkerRequest,
  WorkerResponse,
} from './types';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

/**
 * Main-thread proxy that communicates with a WASM Worker.
 *
 * All calls are serialized as messages and sent to the Worker thread.
 * The API is identical to direct-mode GrafeoDB.
 */
export class WorkerProxy {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  /** Initialize the Worker and the WASM database inside it. */
  async init(options?: CreateOptions): Promise<void> {
    // Create an inline Worker from the bundled worker entry point.
    // This avoids needing a separate file URL, which is problematic
    // with bundlers and CDN usage.
    const workerUrl = new URL('./worker.js', import.meta.url);
    this.worker = new Worker(workerUrl, { type: 'module' });

    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { id, result, error } = event.data;
      const request = this.pending.get(id);
      if (!request) return;

      this.pending.delete(id);
      if (error !== undefined) {
        request.reject(new Error(error));
      } else {
        request.resolve(result);
      }
    };

    this.worker.onerror = (event) => {
      // Reject all pending requests on worker error
      const error = new Error(event.message || 'Worker error');
      for (const request of this.pending.values()) {
        request.reject(error);
      }
      this.pending.clear();
    };

    await this.send('init', [options]);
  }

  /** Send a message to the Worker and wait for a response. */
  private send(method: string, args: unknown[] = []): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }

      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });

      const message: WorkerRequest = { id, method, args };
      this.worker.postMessage(message);
    });
  }

  async execute(
    query: string,
    options?: ExecuteOptions,
  ): Promise<Record<string, unknown>[]> {
    return (await this.send('execute', [query, options])) as Record<
      string,
      unknown
    >[];
  }

  async executeRaw(query: string): Promise<RawQueryResult> {
    return (await this.send('executeRaw', [query])) as RawQueryResult;
  }

  async nodeCount(): Promise<number> {
    return (await this.send('nodeCount')) as number;
  }

  async edgeCount(): Promise<number> {
    return (await this.send('edgeCount')) as number;
  }

  async storageStats(): Promise<StorageStats> {
    return (await this.send('storageStats')) as StorageStats;
  }

  async export(): Promise<DatabaseSnapshot> {
    return (await this.send('export')) as DatabaseSnapshot;
  }

  async import(snapshot: DatabaseSnapshot): Promise<void> {
    await this.send('import', [snapshot]);
  }

  async clear(): Promise<void> {
    await this.send('clear');
  }

  async close(): Promise<void> {
    await this.send('close');
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
