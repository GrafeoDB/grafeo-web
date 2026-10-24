/**
 * Supported query languages.
 *
 * `'graphql-rdf'` is GraphQL over the RDF triple store, and `'sql-pgq'` is an
 * alias of `'sql'` (SQL/PGQ). The lite build accepts GQL only.
 */
export type QueryLanguage =
  | 'gql'
  | 'cypher'
  | 'sparql'
  | 'graphql'
  | 'graphql-rdf'
  | 'gremlin'
  | 'sql'
  | 'sql-pgq';

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

/** What a statement wrote, as `executeRaw()` reports it. */
export interface WriteCounters {
  nodesCreated: number;
  nodesDeleted: number;
  edgesCreated: number;
  edgesDeleted: number;
  propertiesSet: number;
  labelsAdded: number;
  labelsRemoved: number;
}

/** Raw query result with column metadata. */
export interface RawQueryResult {
  columns: string[];
  rows: unknown[][];
  executionTimeMs?: number;
  /** Whether the result holds rows, a boolean (SPARQL `ASK`) or a graph (SPARQL `CONSTRUCT`). */
  kind?: 'rows' | 'boolean' | 'graph';
  /** What the statement wrote; all zero for a read. */
  counters?: WriteCounters;
  /**
   * The operator tree of a `PROFILE` statement, as data.
   *
   * @experimental Its operators and keys may still change in Grafeo 0.6.x.
   */
  profile?: unknown;
}

/** What `compact()` did, as the engine reports it. */
export interface CompactReport {
  /** Whether a checkpoint was written (always `false` in the browser: the database is in memory). */
  checkpointed: boolean;
  /** Old row versions dropped because no open transaction can see them any more. */
  versions_collected: number;
  /** Rows whose property columns were encoded in memory. */
  rows_compressed: number;
  /** How long the compaction took, in milliseconds. */
  duration_ms: number;
}

/** Options for `getNodeEdges()`. */
export interface NodeEdgesOptions {
  /** Which edges: `'out'` (the default), `'in'` or `'both'` (a self-loop is listed once). */
  direction?: 'out' | 'in' | 'both';
  /** Keep only edges of these types. */
  edgeTypes?: string[];
}

/** An edge of a node, as `[neighborId, edgeId]`. */
export type NodeEdge = [neighborId: number, edgeId: number];

/** An edge for `batchCreateEdges()`, between existing node IDs. */
export interface BatchEdge {
  src: number;
  dst: number;
  type: string;
  properties?: Record<string, unknown>;
}

/** Options for `upsertNodes()`. */
export interface UpsertNodesOptions {
  /** The property that identifies a node, together with the labels. Default: `'id'`. */
  key?: string;
  /** Replace a matched node's properties with the row's, instead of merging the row's in. */
  replace?: boolean;
}

/** Options for `upsertEdges()`. */
export interface UpsertEdgesOptions {
  /** The property that identifies an edge. Default: `'id'`. */
  key?: string;
  /** The row field that holds the source node's key. Default: `'src'`. */
  srcField?: string;
  /** The row field that holds the target node's key. Default: `'dst'`. */
  dstField?: string;
  /** The node property the `srcField` and `dstField` values match. Default: `'id'`. */
  endpointKey?: string;
  /** Labels an endpoint must have, all of them. */
  endpointLabels?: string[];
  /** Replace a matched edge's properties with the row's, instead of merging the row's in. */
  replace?: boolean;
}

/** What `upsertNodes()` or `upsertEdges()` did. */
export interface UpsertSummary {
  created: number;
  updated: number;
  skipped: number;
  /** Indexes of the skipped rows: rows without the key, or edges whose endpoints match no node or several. */
  skippedRows: number[];
}

/** Options for creating a BM25 text index. */
export interface TextIndexOptions {
  /** BM25 term-frequency saturation, at least 0. Default: 1.2. */
  k1?: number;
  /** BM25 length normalization, 0 to 1. Default: 0.75. */
  b?: number;
  /**
   * Tokenizer: `'simple'` (the default), `'standard'` (every word, for
   * languages such as Russian or Greek) or `'cjk_bigram'` (pairs of
   * characters, for Chinese, Japanese and Korean).
   */
  tokenizer?: 'simple' | 'standard' | 'cjk_bigram';
  /** Stop words to use in place of the tokenizer's own. */
  stopWords?: string[];
}

/** Options for text and hybrid search. */
export interface TextSearchOptions {
  /**
   * Property filters, as `vectorSearch()` takes them: equality
   * (`{ city: 'Berlin' }`) or operators (`{ rank: { $gt: 19 } }`). Only
   * matching nodes are searched, so up to `k` matching results come back.
   */
  filters?: Record<string, unknown>;
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

/** An edge type entry returned by schema(). */
export interface SchemaEdgeType {
  name: string;
  count: number;
}

/** Schema information returned by schema(). */
export interface SchemaInfo {
  mode: string;
  labels: SchemaLabel[];
  edge_types: SchemaEdgeType[];
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
  /** Extra fields of the error (its `name`, and `gqlStatus` when the engine sets it). */
  errorInfo?: { name?: string; gqlStatus?: string };
}
