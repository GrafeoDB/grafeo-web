/** Supported query languages. */
export type QueryLanguage = 'gql' | 'cypher' | 'sparql' | 'graphql' | 'gremlin';

/** Options for creating a GrafeoDB instance. */
export interface CreateOptions {
  /** IndexedDB key for persistent storage. Omit for in-memory only. */
  persist?: string;
  /** Run WASM execution in a dedicated Web Worker. */
  worker?: boolean;
  /** Debounce interval (ms) for IndexedDB writes. Default: 1000. */
  persistInterval?: number;
}

/** Options for query execution. */
export interface ExecuteOptions {
  /** Query language to use. Default: 'gql'. */
  language?: QueryLanguage;
}

/** IndexedDB storage usage statistics. */
export interface StorageStats {
  /** Bytes currently used by this database. */
  bytesUsed: number;
  /** Total quota available. */
  quota: number;
}

/** A serialized database snapshot for export/import. */
export interface DatabaseSnapshot {
  /** Snapshot format version. */
  version: number;
  /** Serialized database state. */
  data: Uint8Array;
  /** Timestamp when the snapshot was created. */
  timestamp: number;
}

/** A tracked change from the database. */
export interface Change {
  type: 'insert' | 'update' | 'delete';
  timestamp: number;
  data: unknown;
}

/** Raw query result with column metadata. */
export interface RawQueryResult {
  columns: string[];
  rows: unknown[][];
  executionTimeMs?: number;
}

/** Message sent from main thread to worker. */
export interface WorkerRequest {
  id: number;
  method: string;
  args: unknown[];
}

/** Message sent from worker to main thread. */
export interface WorkerResponse {
  id: number;
  result?: unknown;
  error?: string;
}
