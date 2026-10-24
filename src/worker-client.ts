/**
 * `@grafeo-db/web/worker-client`: the database in a Web Worker, driven from
 * the main thread without loading the engine there.
 *
 * The main entry (`@grafeo-db/web`) imports `@grafeo-db/wasm` for direct
 * mode, and the package starts fetching and compiling the engine as soon as
 * it is imported, also when `create({ worker: true })` then runs everything
 * in a worker. This entry imports no engine code at all: only the worker
 * loads the WASM. The API is that of `GrafeoDB` from the main entry, every
 * call answered by the worker.
 *
 * @example
 * ```typescript
 * import { GrafeoDB } from '@grafeo-db/web/worker-client';
 *
 * const db = await GrafeoDB.create({ persist: 'my-app' });
 * await db.execute("INSERT (:Person {name: 'Alix'})");
 * await db.close();
 * ```
 */
import { WorkerProxy } from './worker-proxy';
import type {
  BatchEdge,
  Change,
  CompactReport,
  CreateOptions,
  DatabaseInfo,
  DatabaseSnapshot,
  ExecuteOptions,
  ImportRowsOptions,
  LpgEdge,
  LpgImportData,
  LpgImportResult,
  LpgNode,
  MemoryUsage,
  MmrSearchOptions,
  NodeEdge,
  NodeEdgesOptions,
  QueryLanguage,
  RawQueryResult,
  RdfImportData,
  RdfImportResult,
  RdfLiteral,
  RdfTriple,
  SchemaEdgeType,
  SchemaInfo,
  SchemaLabel,
  SearchResult,
  StorageStats,
  TextIndexOptions,
  TextSearchOptions,
  UpsertEdgesOptions,
  UpsertNodesOptions,
  UpsertSummary,
  VectorIndexOptions,
  VectorResult,
  VectorSearchOptions,
  WriteCounters,
} from './types';

export type {
  BatchEdge,
  Change,
  CompactReport,
  CreateOptions,
  DatabaseInfo,
  DatabaseSnapshot,
  ExecuteOptions,
  ImportRowsOptions,
  LpgEdge,
  LpgImportData,
  LpgImportResult,
  LpgNode,
  MemoryUsage,
  MmrSearchOptions,
  NodeEdge,
  NodeEdgesOptions,
  QueryLanguage,
  RawQueryResult,
  RdfImportData,
  RdfImportResult,
  RdfLiteral,
  RdfTriple,
  SchemaEdgeType,
  SchemaInfo,
  SchemaLabel,
  SearchResult,
  StorageStats,
  TextIndexOptions,
  TextSearchOptions,
  UpsertEdgesOptions,
  UpsertNodesOptions,
  UpsertSummary,
  VectorIndexOptions,
  VectorResult,
  VectorSearchOptions,
  WriteCounters,
};

/** Options for `GrafeoDB.create()` of the worker client. */
export interface WorkerClientOptions extends Omit<CreateOptions, 'worker'> {
  /**
   * The worker to run the database in. Omit it to start `dist/worker.js` of
   * this package; pass your own when your bundler needs it, built from
   * `@grafeo-db/web/worker-src` (in Vite:
   * `import GrafeoWorker from '@grafeo-db/web/worker-src?worker'`, then
   * `{ worker: new GrafeoWorker() }`).
   */
  worker?: Worker;
}

/**
 * A Grafeo graph database running in a Web Worker. Same API as `GrafeoDB`
 * from `@grafeo-db/web`, minus the static `version()`, which needs the
 * engine on the main thread: use `getVersion()`.
 */
export class GrafeoDB {
  private proxy: WorkerProxy | null;
  private closed = false;

  private constructor(proxy: WorkerProxy) {
    this.proxy = proxy;
  }

  /**
   * Starts the worker and opens the database in it.
   *
   * @param options - Persistence settings and, optionally, the worker to use.
   */
  static async create(options?: WorkerClientOptions): Promise<GrafeoDB> {
    const proxy = new WorkerProxy();
    await proxy.init({ ...options, worker: options?.worker ?? true });
    return new GrafeoDB(proxy);
  }

  /** Whether the database is still open and usable. */
  get isOpen(): boolean {
    return !this.closed;
  }

  /** Returns the engine version, as the worker reports it. */
  async getVersion(): Promise<string> {
    return this.open().version();
  }

  /** Executes a query and returns results as an array of objects. */
  async execute<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    options?: ExecuteOptions,
  ): Promise<T[]> {
    return (await this.open().execute(query, options)) as T[];
  }

  /** Executes a query and returns raw columns, rows, and metadata. */
  async executeRaw(query: string, options?: ExecuteOptions): Promise<RawQueryResult> {
    return this.open().executeRaw(query, options);
  }

  /** Returns the number of nodes in the database. */
  async nodeCount(): Promise<number> {
    return this.open().nodeCount();
  }

  /** Returns the number of edges in the database. */
  async edgeCount(): Promise<number> {
    return this.open().edgeCount();
  }

  /** Returns the edges of a node as `[neighborId, edgeId]` pairs, without a query. */
  async getNodeEdges(id: number, options?: NodeEdgesOptions): Promise<NodeEdge[]> {
    return this.open().getNodeEdges(id, options);
  }

  /** Returns schema information (labels, edge types, property keys). */
  async schema(): Promise<SchemaInfo> {
    return this.open().schema();
  }

  /** Returns IndexedDB storage usage statistics. */
  async storageStats(): Promise<StorageStats> {
    return this.open().storageStats();
  }

  /** Exports the full database state as a snapshot. */
  async export(): Promise<DatabaseSnapshot> {
    return this.open().export();
  }

  /** Restores the database from a previously exported snapshot. */
  async import(snapshot: DatabaseSnapshot): Promise<void> {
    return this.open().import(snapshot);
  }

  /** Deletes all data from the database and IndexedDB (if persisted). */
  async clear(): Promise<void> {
    return this.open().clear();
  }

  /**
   * Returns changes since the given timestamp.
   *
   * @experimental Not yet implemented. Will be available when the WASM engine exposes change tracking.
   */
  async changesSince(_timestamp: number): Promise<Change[]> {
    this.open();
    throw new Error('changesSince() is not yet implemented: the WASM engine does not expose change tracking');
  }

  /** Creates a BM25 text index on a label/property. Requires 'text-index' WASM feature. */
  async createTextIndex(label: string, property: string, options?: TextIndexOptions): Promise<void> {
    return this.open().createTextIndex(label, property, options);
  }

  /** Drops a text index. Returns true if one existed. */
  async dropTextIndex(label: string, property: string): Promise<boolean> {
    return this.open().dropTextIndex(label, property);
  }

  /** Rebuilds a text index. */
  async rebuildTextIndex(label: string, property: string): Promise<void> {
    return this.open().rebuildTextIndex(label, property);
  }

  /** Full-text search returning scored results. */
  async textSearch(
    label: string,
    property: string,
    query: string,
    k: number,
    options?: TextSearchOptions,
  ): Promise<SearchResult[]> {
    return this.open().textSearch(label, property, query, k, options);
  }

  /** Combined BM25 + vector search. */
  async hybridSearch(
    label: string,
    textProp: string,
    vectorProp: string,
    queryText: string,
    k: number,
    options?: TextSearchOptions,
  ): Promise<SearchResult[]> {
    return this.open().hybridSearch(label, textProp, vectorProp, queryText, k, options);
  }

  /** Creates an HNSW vector index. */
  async createVectorIndex(label: string, property: string, options?: VectorIndexOptions): Promise<void> {
    return this.open().createVectorIndex(label, property, options);
  }

  /** Drops a vector index. Returns true if one existed. */
  async dropVectorIndex(label: string, property: string): Promise<boolean> {
    return this.open().dropVectorIndex(label, property);
  }

  /** Rebuilds a vector index by re-scanning matching nodes. */
  async rebuildVectorIndex(label: string, property: string): Promise<void> {
    return this.open().rebuildVectorIndex(label, property);
  }

  /** k-NN vector search. */
  async vectorSearch(
    label: string,
    property: string,
    query: Float32Array,
    k: number,
    options?: VectorSearchOptions,
  ): Promise<VectorResult[]> {
    return this.open().vectorSearch(label, property, query, k, options);
  }

  /** MMR search for diverse results. */
  async mmrSearch(
    label: string,
    property: string,
    query: Float32Array,
    k: number,
    options?: MmrSearchOptions,
  ): Promise<VectorResult[]> {
    return this.open().mmrSearch(label, property, query, k, options);
  }

  /** k-NN vector search for several query vectors at once; one result list per query. */
  async batchVectorSearch(
    label: string,
    property: string,
    queries: (Float32Array | number[])[],
    k: number,
    options?: VectorSearchOptions,
  ): Promise<VectorResult[][]> {
    return this.open().batchVectorSearch(label, property, queries, k, options);
  }

  /** Creates a named graph projection. Returns `false` if the name is taken. */
  async createProjection(name: string, nodeLabels?: string[], edgeTypes?: string[]): Promise<boolean> {
    return this.open().createProjection(name, nodeLabels, edgeTypes);
  }

  /** Drops a named graph projection. Returns `true` if it existed. */
  async dropProjection(name: string): Promise<boolean> {
    return this.open().dropProjection(name);
  }

  /** Returns the names of all active graph projections. */
  async listProjections(): Promise<string[]> {
    return this.open().listProjections();
  }

  /** Sets the current schema context for subsequent queries. */
  async setSchema(name: string): Promise<void> {
    return this.open().setSchema(name);
  }

  /** Clears the current schema context. */
  async resetSchema(): Promise<void> {
    return this.open().resetSchema();
  }

  /** Returns the current schema name, or undefined if none is set. */
  async currentSchema(): Promise<string | undefined> {
    return this.open().currentSchema();
  }

  /** Drops the old row versions no open transaction can see any more. */
  async compact(): Promise<CompactReport> {
    return this.open().compact();
  }

  /** Clears the query plan cache. */
  async clearPlanCache(): Promise<void> {
    return this.open().clearPlanCache();
  }

  /** Returns a hierarchical memory usage breakdown. */
  async memoryUsage(): Promise<MemoryUsage> {
    return this.open().memoryUsage();
  }

  /** Returns high-level database information (counts, mode, compiled features). */
  async info(): Promise<DatabaseInfo> {
    return this.open().info();
  }

  /** Bulk-imports rows (array of objects) as nodes or edges. */
  async importRows(rows: Record<string, unknown>[], options: ImportRowsOptions): Promise<number> {
    return this.open().importRows(rows, options);
  }

  /** Bulk-imports LPG nodes and edges in a single call. */
  async importLpg(data: LpgImportData): Promise<LpgImportResult> {
    return this.open().importLpg(data);
  }

  /** Bulk-imports RDF triples in a single call. */
  async importRdf(data: RdfImportData): Promise<RdfImportResult> {
    return this.open().importRdf(data);
  }

  /** Creates one node per row in one transaction; returns their IDs. Throws while a transaction is open. */
  async batchCreateNodesWithProps(labels: string | string[], rows: Record<string, unknown>[]): Promise<number[]> {
    return this.open().batchCreateNodesWithProps(labels, rows);
  }

  /** Creates edges between existing nodes in one transaction; returns their IDs. Throws while a transaction is open. */
  async batchCreateEdges(edges: BatchEdge[]): Promise<number[]> {
    return this.open().batchCreateEdges(edges);
  }

  /** Creates or updates nodes matched by a key property. */
  async upsertNodes(
    labels: string | string[],
    rows: Record<string, unknown>[],
    options?: UpsertNodesOptions,
  ): Promise<UpsertSummary> {
    return this.open().upsertNodes(labels, rows, options);
  }

  /** Creates or updates edges between existing nodes, matched by a key property. */
  async upsertEdges(
    edgeType: string,
    rows: Record<string, unknown>[],
    options?: UpsertEdgesOptions,
  ): Promise<UpsertSummary> {
    return this.open().upsertEdges(edgeType, rows, options);
  }

  /** Begins a new transaction. */
  async beginTransaction(): Promise<void> {
    return this.open().beginTransaction();
  }

  /** Commits the active transaction. */
  async commitTransaction(): Promise<void> {
    return this.open().commitTransaction();
  }

  /** Rolls back the active transaction, discarding pending writes. */
  async rollbackTransaction(): Promise<void> {
    return this.open().rollbackTransaction();
  }

  /** Returns true while a transaction is active. */
  async isTransactionActive(): Promise<boolean> {
    return this.open().isTransactionActive();
  }

  /** Exports a tamper-evident snapshot signed with `key`. */
  async signedExport(key: Uint8Array): Promise<Uint8Array> {
    return this.open().signedExport(key);
  }

  /** Restores from a signed snapshot, verifying it with `key`. */
  async signedImport(data: Uint8Array, key: Uint8Array): Promise<void> {
    return this.open().signedImport(data, key);
  }

  /** Saves pending changes, closes the database and stops the worker. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const proxy = this.proxy;
    this.proxy = null;
    await proxy?.close();
  }

  /** The proxy of an open database; throws once it is closed. */
  private open(): WorkerProxy {
    if (this.closed || !this.proxy) {
      throw new Error('Database is closed');
    }
    return this.proxy;
  }
}
