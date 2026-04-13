/** Supported query languages. */
export type QueryLanguage = 'gql' | 'cypher' | 'sparql' | 'graphql' | 'gremlin' | 'sql';

/** Options for creating a GrafeoDB instance. */
export interface CreateOptions {
  /** IndexedDB key for persistent storage. Omit for in-memory only. */
  persist?: string;
  /** Run WASM execution in a dedicated Web Worker. Pass `true` for auto-creation, or a pre-created Worker instance for bundler-friendly usage. */
  worker?: boolean | Worker;
  /** Debounce interval (ms) for IndexedDB writes. Default: 1000. */
  persistInterval?: number;
  /** Called when an IndexedDB persistence error occurs. Defaults to `console.error`. */
  onPersistError?: (error: Error) => void;
}

/** Options for creating a GrafeoDB lite instance (no worker support). */
export interface LiteCreateOptions {
  /** IndexedDB key for persistent storage. Omit for in-memory only. */
  persist?: string;
  /** Debounce interval (ms) for IndexedDB writes. Default: 1000. */
  persistInterval?: number;
  /** Called when an IndexedDB persistence error occurs. Defaults to `console.error`. */
  onPersistError?: (error: Error) => void;
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

/** Options for creating a vector index. */
export interface VectorIndexOptions {
  /** Number of dimensions. Inferred from data if omitted. */
  dimensions?: number;
  /** Distance metric: "cosine", "euclidean", "dot_product", or "manhattan". */
  metric?: 'cosine' | 'euclidean' | 'dot_product' | 'manhattan';
  /** HNSW links per node. */
  m?: number;
  /** HNSW build beam width. */
  efConstruction?: number;
  /** Quantization strategy for memory reduction: "scalar", "binary", or "product". */
  quantization?: 'scalar' | 'binary' | 'product';
}

/** Options for vector k-NN search. */
export interface VectorSearchOptions {
  /** Search beam width (higher = more accurate but slower). */
  ef?: number;
  /** Property filters to apply before search. */
  filters?: Record<string, unknown>;
}

/** Options for MMR (Maximal Marginal Relevance) search. */
export interface MmrSearchOptions {
  /** Number of candidates to fetch before re-ranking. */
  fetchK?: number;
  /** Balance between relevance (1.0) and diversity (0.0). */
  lambda?: number;
  /** Search beam width. */
  ef?: number;
  /** Property filters to apply before search. */
  filters?: Record<string, unknown>;
}

/** A vector search result with node ID and distance. */
export interface VectorResult {
  id: number;
  distance: number;
}

/** Options for importRows(). */
export interface ImportRowsOptions {
  /** Import mode: "nodes" or "edges". */
  mode: 'nodes' | 'edges';
  /** Node label(s). Required for mode "nodes". */
  label?: string | string[];
  /** Edge type. Required for mode "edges". */
  edgeType?: string;
  /** Source column name (default "source"). For mode "edges". */
  source?: string;
  /** Target column name (default "target"). For mode "edges". */
  target?: string;
}

/** High-level database information returned by info(). */
export interface DatabaseInfo {
  /** Database mode ("Lpg" or "Rdf"). */
  mode: string;
  /** Number of nodes. */
  node_count: number;
  /** Number of edges. */
  edge_count: number;
  /** Whether the database is backed by a file. */
  is_persistent: boolean;
  /** Database file path, if persistent. */
  path: string | null;
  /** Whether WAL is enabled. */
  wal_enabled: boolean;
  /** Engine version string. */
  version: string;
  /** Compiled feature flags (e.g. "gql", "cypher", "algos", "vector-index"). */
  features: string[];
}

/** Hierarchical memory usage breakdown. */
export interface MemoryUsage {
  total_bytes: number;
  store: { total_bytes: number };
  indexes: { total_bytes: number };
  mvcc: { total_bytes: number };
  caches: { total_bytes: number };
  string_pool: { total_bytes: number };
  buffer_manager: { total_bytes: number };
  [key: string]: unknown;
}

/** A label entry returned by schema(). */
export interface SchemaLabel {
  name: string;
  count: number;
}

/** Schema information returned by schema(). */
export interface SchemaInfo {
  mode: string;
  labels: SchemaLabel[];
  edge_types: string[];
  property_keys: string[];
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
