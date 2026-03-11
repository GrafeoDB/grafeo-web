/** Supported query languages. */
export type QueryLanguage = 'gql' | 'cypher' | 'sparql' | 'graphql' | 'gremlin' | 'sql';

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
  /** Named parameters to bind into the query (e.g. `{ name: 'Alice' }` for `$name`). */
  params?: Record<string, unknown>;
}

/** Options for lite query execution (GQL only, no language selection). */
export interface LiteExecuteOptions {
  /** Named parameters to bind into the query. */
  params?: Record<string, unknown>;
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

/** A scored search result from text or hybrid search. */
export interface SearchResult {
  id: number;
  score: number;
}

/** Raw query result with column metadata. */
export interface RawQueryResult {
  columns: string[];
  rows: unknown[][];
  executionTimeMs?: number;
}

/** A node to import via importLpg(). */
export interface LpgNode {
  labels: string[];
  properties?: Record<string, unknown>;
}

/** An edge to import via importLpg(). Source/target are zero-based indexes into the nodes array. */
export interface LpgEdge {
  source: number;
  target: number;
  type: string;
  properties?: Record<string, unknown>;
}

/** Input for bulk LPG import. */
export interface LpgImportData {
  nodes: LpgNode[];
  edges: LpgEdge[];
}

/** Result of a bulk LPG import. */
export interface LpgImportResult {
  nodes: number;
  edges: number;
}

/** An RDF literal object with optional datatype or language tag. */
export interface RdfLiteral {
  value: string;
  datatype?: string;
  language?: string;
}

/** An RDF triple for bulk import. Object can be an IRI string or a structured literal. */
export interface RdfTriple {
  subject: string;
  predicate: string;
  object: string | RdfLiteral;
}

/** Input for bulk RDF import. */
export interface RdfImportData {
  triples: RdfTriple[];
}

/** Result of a bulk RDF import. */
export interface RdfImportResult {
  triples: number;
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
