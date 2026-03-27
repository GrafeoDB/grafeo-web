import type {
  CreateOptions,
  DatabaseSnapshot,
  ExecuteOptions,
  ImportRowsOptions,
  LpgImportData,
  LpgImportResult,
  MemoryUsage,
  MmrSearchOptions,
  RawQueryResult,
  RdfImportData,
  RdfImportResult,
  SearchResult,
  StorageStats,
  VectorIndexOptions,
  VectorResult,
  VectorSearchOptions,
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
    if (options?.worker instanceof Worker) {
      // Use pre-created Worker (bundler-friendly: caller handles URL resolution)
      this.worker = options.worker;
    } else {
      // Auto-create Worker, resolving URL relative to this module.
      // Note: import.meta.url is only available in ESM.
      const workerUrl = new URL(
        './worker.js',
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore -- import.meta.url is ESM-only; CJS build warns but worker is ESM-first
        import.meta.url,
      );
      this.worker = new Worker(workerUrl, { type: 'module' });
    }

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

    // Send only serializable options to the worker (Worker instances can't be cloned)
    const initOptions = options
      ? { persist: options.persist, persistInterval: options.persistInterval }
      : undefined;
    await this.send('init', [initOptions]);
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

  async version(): Promise<string> {
    return (await this.send('version')) as string;
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

  async executeRaw(query: string, options?: ExecuteOptions): Promise<RawQueryResult> {
    return (await this.send('executeRaw', [query, options])) as RawQueryResult;
  }

  async nodeCount(): Promise<number> {
    return (await this.send('nodeCount')) as number;
  }

  async edgeCount(): Promise<number> {
    return (await this.send('edgeCount')) as number;
  }

  async schema(): Promise<unknown> {
    return this.send('schema');
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

  async createTextIndex(label: string, property: string): Promise<void> {
    await this.send('createTextIndex', [label, property]);
  }

  async dropTextIndex(label: string, property: string): Promise<boolean> {
    return (await this.send('dropTextIndex', [label, property])) as boolean;
  }

  async rebuildTextIndex(label: string, property: string): Promise<void> {
    await this.send('rebuildTextIndex', [label, property]);
  }

  async textSearch(
    label: string,
    property: string,
    query: string,
    k: number,
  ): Promise<SearchResult[]> {
    return (await this.send('textSearch', [label, property, query, k])) as SearchResult[];
  }

  async hybridSearch(
    label: string,
    textProp: string,
    vectorProp: string,
    queryText: string,
    k: number,
  ): Promise<SearchResult[]> {
    return (await this.send('hybridSearch', [label, textProp, vectorProp, queryText, k])) as SearchResult[];
  }

  async createVectorIndex(label: string, property: string, options?: VectorIndexOptions): Promise<void> {
    await this.send('createVectorIndex', [label, property, options]);
  }

  async dropVectorIndex(label: string, property: string): Promise<boolean> {
    return (await this.send('dropVectorIndex', [label, property])) as boolean;
  }

  async rebuildVectorIndex(label: string, property: string): Promise<void> {
    await this.send('rebuildVectorIndex', [label, property]);
  }

  async vectorSearch(
    label: string,
    property: string,
    query: Float32Array,
    k: number,
    options?: VectorSearchOptions,
  ): Promise<VectorResult[]> {
    return (await this.send('vectorSearch', [label, property, query, k, options])) as VectorResult[];
  }

  async mmrSearch(
    label: string,
    property: string,
    query: Float32Array,
    k: number,
    options?: MmrSearchOptions,
  ): Promise<VectorResult[]> {
    return (await this.send('mmrSearch', [label, property, query, k, options])) as VectorResult[];
  }

  async setSchema(name: string): Promise<void> {
    await this.send('setSchema', [name]);
  }

  async resetSchema(): Promise<void> {
    await this.send('resetSchema');
  }

  async currentSchema(): Promise<string | undefined> {
    return (await this.send('currentSchema')) as string | undefined;
  }

  async clearPlanCache(): Promise<void> {
    await this.send('clearPlanCache');
  }

  async memoryUsage(): Promise<MemoryUsage> {
    return (await this.send('memoryUsage')) as MemoryUsage;
  }

  async importRows(rows: Record<string, unknown>[], options: ImportRowsOptions): Promise<number> {
    return (await this.send('importRows', [rows, options])) as number;
  }

  async importLpg(data: LpgImportData): Promise<LpgImportResult> {
    return (await this.send('importLpg', [data])) as LpgImportResult;
  }

  async importRdf(data: RdfImportData): Promise<RdfImportResult> {
    return (await this.send('importRdf', [data])) as RdfImportResult;
  }

  async close(): Promise<void> {
    await this.send('close');
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
