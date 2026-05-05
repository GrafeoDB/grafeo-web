import { Database as WasmDatabase } from '@grafeo-db/wasm';

import { PersistenceManager } from './persistence';
import { ensureWasmInitialized } from './wasm-init';
import { WorkerProxy } from './worker-proxy';
import type {
  Change,
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
  QueryLanguage,
  RawQueryResult,
  RdfImportData,
  RdfImportResult,
  RdfLiteral,
  RdfTriple,
  SchemaInfo,
  SchemaLabel,
  SearchResult,
  StorageStats,
  VectorIndexOptions,
  VectorResult,
  VectorSearchOptions,
} from './types';

export type {
  Change,
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
  QueryLanguage,
  RawQueryResult,
  RdfImportData,
  RdfImportResult,
  RdfLiteral,
  RdfTriple,
  SchemaInfo,
  SchemaLabel,
  SearchResult,
  StorageStats,
  VectorIndexOptions,
  VectorResult,
  VectorSearchOptions,
};

/**
 * A Grafeo graph database running in the browser via WebAssembly.
 *
 * Use the static `create()` factory to instantiate. All methods are async
 * since they may involve WASM calls, IndexedDB I/O, or Worker messaging.
 *
 * @example
 * ```typescript
 * const db = await GrafeoDB.create({ persist: 'mydb' });
 * await db.execute("INSERT (:Person {name: 'Alice', age: 30})");
 * const result = await db.execute("MATCH (p:Person) RETURN p.name, p.age");
 * console.log(result); // [{ "p.name": "Alice", "p.age": 30 }]
 * await db.close();
 * ```
 */
export class GrafeoDB {
  private wasm: WasmDatabase | null;
  private persistence: PersistenceManager | null;
  private proxy: WorkerProxy | null;
  private closed = false;

  private constructor(
    wasm: WasmDatabase | null,
    persistence: PersistenceManager | null,
    proxy: WorkerProxy | null,
  ) {
    this.wasm = wasm;
    this.persistence = persistence;
    this.proxy = proxy;
  }

  /** Returns the Grafeo WASM engine version (requires main-thread WASM init). */
  static version(): string {
    return WasmDatabase.version();
  }

  /** Returns the engine version. Works in both direct and worker modes. */
  async getVersion(): Promise<string> {
    if (this.proxy) {
      return this.proxy.version();
    }
    return WasmDatabase.version();
  }

  /**
   * Creates a new GrafeoDB instance.
   *
   * @param options - Configuration for persistence and worker mode.
   * @returns A ready-to-use database instance.
   */
  static async create(options?: CreateOptions): Promise<GrafeoDB> {
    if (options?.worker) {
      return GrafeoDB.createWithWorker(options);
    }

    await ensureWasmInitialized();

    let persistence: PersistenceManager | null = null;
    let wasm: WasmDatabase;

    if (options?.persist) {
      persistence = new PersistenceManager(
        options.persist,
        options.persistInterval,
        options.onPersistError,
      );
      const snapshot = await persistence.load();
      if (snapshot) {
        try {
          wasm = WasmDatabase.importSnapshot(snapshot);
        } catch (err) {
          console.warn(
            `[grafeo-web] Persisted snapshot for "${options.persist}" is incompatible with this WASM version (likely a storage-format change). Starting with a fresh database. The incompatible snapshot has been kept under the key "${options.persist}__backup".`,
            err,
          );
          // Backup the incompatible snapshot before clearing
          const backupPersistence = new PersistenceManager(
            `${options.persist}__backup`,
          );
          await backupPersistence.save(snapshot);
          wasm = new WasmDatabase();
          await persistence.clear();
        }
      } else {
        wasm = new WasmDatabase();
      }
    } else {
      wasm = new WasmDatabase();
    }

    return new GrafeoDB(wasm, persistence, null);
  }

  private static async createWithWorker(
    options: CreateOptions,
  ): Promise<GrafeoDB> {
    const proxy = new WorkerProxy();
    await proxy.init(options);
    return new GrafeoDB(null, null, proxy);
  }

  /** Whether the database is still open and usable. */
  get isOpen(): boolean {
    return !this.closed;
  }

  /**
   * Executes a query and returns results as an array of objects.
   *
   * @param query - The query string (GQL by default).
   * @param options - Optional execution options (language selection).
   * @returns Array of result rows as key-value objects.
   */
  async execute<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    options?: ExecuteOptions,
  ): Promise<T[]> {
    this.assertOpen();

    if (this.proxy) {
      return this.proxy.execute(query, options) as Promise<T[]>;
    }

    const lang = options?.language;
    const params = options?.params;
    const hasLang = lang && lang !== 'gql';

    let result: T[];
    if (hasLang && params) {
      result = this.wasm!.executeWithLanguageAndParams(query, lang, params) as T[];
    } else if (hasLang) {
      result = this.wasm!.executeWithLanguage(query, lang) as T[];
    } else if (params) {
      result = this.wasm!.executeWithParams(query, params) as T[];
    } else {
      result = this.wasm!.execute(query) as T[];
    }

    if (this.persistence) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }

    return result;
  }

  /**
   * Executes a query and returns raw columns, rows, and metadata.
   *
   * Note: `params` in options is not supported for raw queries and will be ignored.
   * Use `execute()` for parameterized queries.
   *
   * @param query - The query string.
   * @param options - Optional execution options (language selection).
   * @returns Raw result with columns, rows, and optional execution time.
   */
  async executeRaw(query: string, options?: Pick<ExecuteOptions, 'language'>): Promise<RawQueryResult> {
    this.assertOpen();

    if (this.proxy) {
      return this.proxy.executeRaw(query, options);
    }

    const lang = options?.language;
    const result = lang && lang !== 'gql'
      ? this.wasm!.executeRawWithLanguage(query, lang)
      : this.wasm!.executeRaw(query);

    if (this.persistence) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }

    return result as RawQueryResult;
  }

  /** Returns the number of nodes in the database. */
  async nodeCount(): Promise<number> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.nodeCount();
    }
    return this.wasm!.nodeCount();
  }

  /** Returns the number of edges in the database. */
  async edgeCount(): Promise<number> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.edgeCount();
    }
    return this.wasm!.edgeCount();
  }

  /** Returns schema information (labels, edge types, property keys). */
  async schema(): Promise<SchemaInfo> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.schema() as Promise<SchemaInfo>;
    }
    return this.wasm!.schema() as SchemaInfo;
  }

  /** Returns IndexedDB storage usage statistics. */
  async storageStats(): Promise<StorageStats> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.storageStats();
    }
    if (this.persistence) {
      return this.persistence.storageStats();
    }
    return { bytesUsed: 0, quota: 0 };
  }

  /** Exports the full database state as a snapshot. */
  async export(): Promise<DatabaseSnapshot> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.export();
    }
    const data = this.wasm!.exportSnapshot();
    return {
      version: 1,
      data,
      timestamp: Date.now(),
    };
  }

  /** Restores the database from a previously exported snapshot. */
  async import(snapshot: DatabaseSnapshot): Promise<void> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.import(snapshot);
    }
    const newWasm = WasmDatabase.importSnapshot(snapshot.data);
    this.wasm!.free();
    this.wasm = newWasm;
    if (this.persistence) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
  }

  /** Deletes all data from the database and IndexedDB (if persisted). */
  async clear(): Promise<void> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.clear();
    }

    // Create a fresh WASM database
    this.wasm!.free();
    this.wasm = new WasmDatabase();

    if (this.persistence) {
      await this.persistence.clear();
    }
  }

  /**
   * Returns changes since the given timestamp.
   *
   * @experimental Not yet implemented. Will be available when the WASM engine exposes change tracking.
   */
  async changesSince(_timestamp: number): Promise<Change[]> {
    this.assertOpen();
    throw new Error('changesSince() is not yet implemented: the WASM engine does not expose change tracking');
  }

  /** Creates a BM25 text index on a label/property. Requires 'text-index' WASM feature. */
  async createTextIndex(label: string, property: string): Promise<void> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.createTextIndex(label, property);
    }
    this.assertFeature('createTextIndex', 'text-index');
    this.wasm!.createTextIndex(label, property);
    if (this.persistence) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
  }

  /** Drops a text index. Returns true if one existed. Requires 'text-index' WASM feature. */
  async dropTextIndex(label: string, property: string): Promise<boolean> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.dropTextIndex(label, property);
    }
    this.assertFeature('dropTextIndex', 'text-index');
    const existed = this.wasm!.dropTextIndex(label, property);
    if (this.persistence) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
    return existed;
  }

  /** Rebuilds a text index. Requires 'text-index' WASM feature. */
  async rebuildTextIndex(label: string, property: string): Promise<void> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.rebuildTextIndex(label, property);
    }
    this.assertFeature('rebuildTextIndex', 'text-index');
    this.wasm!.rebuildTextIndex(label, property);
    if (this.persistence) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
  }

  /** Full-text search returning scored results. Requires 'text-index' WASM feature. */
  async textSearch(
    label: string,
    property: string,
    query: string,
    k: number,
  ): Promise<SearchResult[]> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.textSearch(label, property, query, k);
    }
    this.assertFeature('textSearch', 'text-index');
    return this.wasm!.textSearch(label, property, query, k);
  }

  /** Combined BM25 + vector search. Requires 'hybrid-search' WASM feature. */
  async hybridSearch(
    label: string,
    textProp: string,
    vectorProp: string,
    queryText: string,
    k: number,
  ): Promise<SearchResult[]> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.hybridSearch(label, textProp, vectorProp, queryText, k);
    }
    this.assertFeature('hybridSearch', 'hybrid-search');
    return this.wasm!.hybridSearch(label, textProp, vectorProp, queryText, k);
  }

  /** Creates an HNSW vector index. Requires 'vector-index' WASM feature. */
  async createVectorIndex(
    label: string,
    property: string,
    options?: VectorIndexOptions,
  ): Promise<void> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.createVectorIndex(label, property, options);
    }
    this.assertFeature('createVectorIndex', 'vector-index');
    this.wasm!.createVectorIndex(label, property, options);
    if (this.persistence) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
  }

  /** Drops a vector index. Returns true if one existed. Requires 'vector-index' WASM feature. */
  async dropVectorIndex(label: string, property: string): Promise<boolean> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.dropVectorIndex(label, property);
    }
    this.assertFeature('dropVectorIndex', 'vector-index');
    const existed = this.wasm!.dropVectorIndex(label, property);
    if (this.persistence) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
    return existed;
  }

  /** Rebuilds a vector index by re-scanning matching nodes. Requires 'vector-index' WASM feature. */
  async rebuildVectorIndex(label: string, property: string): Promise<void> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.rebuildVectorIndex(label, property);
    }
    this.assertFeature('rebuildVectorIndex', 'vector-index');
    this.wasm!.rebuildVectorIndex(label, property);
    if (this.persistence) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
  }

  /** k-NN vector search. Requires 'vector-index' WASM feature. */
  async vectorSearch(
    label: string,
    property: string,
    query: Float32Array,
    k: number,
    options?: VectorSearchOptions,
  ): Promise<VectorResult[]> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.vectorSearch(label, property, query, k, options);
    }
    this.assertFeature('vectorSearch', 'vector-index');
    return this.wasm!.vectorSearch(label, property, query, k, options) as VectorResult[];
  }

  /** MMR search for diverse results. Requires 'vector-index' WASM feature. */
  async mmrSearch(
    label: string,
    property: string,
    query: Float32Array,
    k: number,
    options?: MmrSearchOptions,
  ): Promise<VectorResult[]> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.mmrSearch(label, property, query, k, options);
    }
    this.assertFeature('mmrSearch', 'vector-index');
    return this.wasm!.mmrSearch(label, property, query, k, options) as VectorResult[];
  }

  /**
   * Creates a named graph projection (a read-only filtered view of the graph).
   * Only nodes with matching labels and edges with matching types are visible.
   *
   * @param name - Unique projection name.
   * @param nodeLabels - Optional label filter. Omit to include all nodes.
   * @param edgeTypes - Optional edge-type filter. Omit to include all edges.
   * @returns `true` if created, `false` if a projection with that name already exists.
   */
  async createProjection(
    name: string,
    nodeLabels?: string[],
    edgeTypes?: string[],
  ): Promise<boolean> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.createProjection(name, nodeLabels, edgeTypes);
    }
    const created = this.wasm!.createProjection(name, nodeLabels, edgeTypes);
    if (this.persistence) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
    return created;
  }

  /**
   * Drops a named graph projection.
   *
   * @returns `true` if the projection existed and was removed.
   */
  async dropProjection(name: string): Promise<boolean> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.dropProjection(name);
    }
    const existed = this.wasm!.dropProjection(name);
    if (this.persistence) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
    return existed;
  }

  /** Returns the names of all active graph projections. */
  async listProjections(): Promise<string[]> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.listProjections();
    }
    return this.wasm!.listProjections();
  }

  /** Sets the current schema context for subsequent queries. */
  async setSchema(name: string): Promise<void> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.setSchema(name);
    }
    this.wasm!.setSchema(name);
  }

  /** Clears the current schema context. */
  async resetSchema(): Promise<void> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.resetSchema();
    }
    this.wasm!.resetSchema();
  }

  /** Returns the current schema name, or undefined if none is set. */
  async currentSchema(): Promise<string | undefined> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.currentSchema();
    }
    return this.wasm!.currentSchema();
  }

  /**
   * Rebuilds the database into a layered CompactStore: a columnar read-optimized base
   * with a writable overlay. Non-destructive: writes after `compact()` land in the overlay,
   * reads merge both layers. Gives large memory and traversal wins for mostly-read workloads.
   * Requires 'compact-store' WASM feature.
   */
  async compact(): Promise<void> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.compact();
    }
    this.assertFeature('compact', 'compact-store');
    (this.wasm as unknown as { compact(): void }).compact();
    if (this.persistence) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
  }

  /** Clears the query plan cache. */
  async clearPlanCache(): Promise<void> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.clearPlanCache();
    }
    this.wasm!.clearPlanCache();
  }

  /** Returns a hierarchical memory usage breakdown. */
  async memoryUsage(): Promise<MemoryUsage> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.memoryUsage();
    }
    return this.wasm!.memoryUsage() as MemoryUsage;
  }

  /** Returns high-level database information (counts, mode, compiled features). */
  async info(): Promise<DatabaseInfo> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.info();
    }
    return this.wasm!.info() as DatabaseInfo;
  }

  /**
   * Bulk-imports rows (array of objects) as nodes or edges.
   * The browser equivalent of Python's `import_df()`.
   *
   * @returns The number of created entities.
   */
  async importRows(
    rows: Record<string, unknown>[],
    options: ImportRowsOptions,
  ): Promise<number> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.importRows(rows, options);
    }
    const count = this.wasm!.importRows(rows, options);
    if (this.persistence) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
    return count;
  }

  /**
   * Bulk-imports LPG nodes and edges in a single call.
   *
   * Edge `source`/`target` are zero-based indexes into the `nodes` array
   * from the same import batch.
   *
   * @returns The count of imported nodes and edges.
   */
  async importLpg(data: LpgImportData): Promise<LpgImportResult> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.importLpg(data);
    }
    const result = this.wasm!.importLpg(data) as LpgImportResult;
    if (this.persistence) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
    return result;
  }

  /**
   * Bulk-imports RDF triples in a single call.
   * Requires `@grafeo-db/wasm` built with the `rdf` feature.
   *
   * @returns The count of imported triples.
   */
  async importRdf(data: RdfImportData): Promise<RdfImportResult> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.importRdf(data);
    }
    this.assertFeature('importRdf', 'rdf');
    const result = this.wasm!.importRdf(data) as RdfImportResult;
    if (this.persistence) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
    return result;
  }

  /**
   * Begins a new transaction. Subsequent `execute*` calls see each other's
   * uncommitted writes until `commitTransaction()` or `rollbackTransaction()`.
   * Only one transaction may be active at a time.
   */
  async beginTransaction(): Promise<void> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.beginTransaction();
    }
    this.wasm!.beginTransaction();
  }

  /** Commits the active transaction. Persists writes if the database is persistent. */
  async commitTransaction(): Promise<void> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.commitTransaction();
    }
    this.wasm!.commitTransaction();
    if (this.persistence) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
  }

  /** Rolls back the active transaction, discarding pending writes. */
  async rollbackTransaction(): Promise<void> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.rollbackTransaction();
    }
    this.wasm!.rollbackTransaction();
  }

  /** Returns true while a transaction is active. */
  async isTransactionActive(): Promise<boolean> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.isTransactionActive();
    }
    return this.wasm!.isTransactionActive();
  }

  /**
   * Exports a tamper-evident snapshot: prefixed with a `GSN1` magic header
   * and an HMAC-SHA256 tag computed with `key`. Restore with `signedImport()`
   * using the same `key`. Recommended whenever snapshots travel through
   * locations the user cannot fully trust.
   */
  async signedExport(key: Uint8Array): Promise<Uint8Array> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.signedExport(key);
    }
    return this.wasm!.exportSnapshotSigned(key);
  }

  /**
   * Restores from a signed snapshot produced by `signedExport()`. Verifies
   * the HMAC tag in constant time; throws if the data is truncated, signed
   * with a different key, or missing the `GSN1` header.
   */
  async signedImport(data: Uint8Array, key: Uint8Array): Promise<void> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.signedImport(data, key);
    }
    const newWasm = WasmDatabase.importSnapshotSigned(data, key);
    this.wasm!.free();
    this.wasm = newWasm;
    if (this.persistence) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
  }

  /** Releases WASM memory and closes any open resources. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.proxy) {
      await this.proxy.close();
      this.proxy = null;
      return;
    }

    if (this.persistence) {
      await this.persistence.flush(() => this.wasm!.exportSnapshot());
      this.persistence = null;
    }

    if (this.wasm) {
      this.wasm.free();
      this.wasm = null;
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('Database is closed');
    }
  }

  private assertFeature(methodName: string, featureName: string): void {
    if (typeof (this.wasm as unknown as Record<string, unknown>)[methodName] !== 'function') {
      throw new Error(
        `${methodName}() requires @grafeo-db/wasm built with the '${featureName}' feature`,
      );
    }
  }
}
