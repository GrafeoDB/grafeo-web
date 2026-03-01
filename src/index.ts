import { Database as WasmDatabase } from '@grafeo-db/wasm';

import { PersistenceManager } from './persistence';
import { isMutatingQuery } from './query-utils';
import { ensureWasmInitialized } from './wasm-init';
import { WorkerProxy } from './worker-proxy';
import type {
  Change,
  CreateOptions,
  DatabaseSnapshot,
  ExecuteOptions,
  QueryLanguage,
  RawQueryResult,
  SearchResult,
  StorageStats,
} from './types';

export type {
  Change,
  CreateOptions,
  DatabaseSnapshot,
  ExecuteOptions,
  QueryLanguage,
  RawQueryResult,
  SearchResult,
  StorageStats,
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

  /** Returns the Grafeo WASM engine version. */
  static version(): string {
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
      );
      const snapshot = await persistence.load();
      wasm = snapshot
        ? WasmDatabase.importSnapshot(snapshot)
        : new WasmDatabase();
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
  async execute(
    query: string,
    options?: ExecuteOptions,
  ): Promise<Record<string, unknown>[]> {
    this.assertOpen();

    if (this.proxy) {
      return this.proxy.execute(query, options);
    }

    const lang = options?.language;
    const params = options?.params;
    const hasLang = lang && lang !== 'gql';

    let result: Record<string, unknown>[];
    if (hasLang && params) {
      result = this.wasm!.executeWithLanguageAndParams(query, lang, params) as Record<string, unknown>[];
    } else if (hasLang) {
      result = this.wasm!.executeWithLanguage(query, lang) as Record<string, unknown>[];
    } else if (params) {
      result = this.wasm!.executeWithParams(query, params) as Record<string, unknown>[];
    } else {
      result = this.wasm!.execute(query) as Record<string, unknown>[];
    }

    if (this.persistence && isMutatingQuery(query)) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }

    return result;
  }

  /**
   * Executes a query and returns raw columns, rows, and metadata.
   *
   * @param query - The query string.
   * @param options - Optional execution options (language selection).
   * @returns Raw result with columns, rows, and optional execution time.
   */
  async executeRaw(query: string, options?: ExecuteOptions): Promise<RawQueryResult> {
    this.assertOpen();

    if (this.proxy) {
      return this.proxy.executeRaw(query, options);
    }

    const lang = options?.language;
    const result = lang && lang !== 'gql'
      ? this.wasm!.executeRawWithLanguage(query, lang)
      : this.wasm!.executeRaw(query);

    if (this.persistence && isMutatingQuery(query)) {
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
  async schema(): Promise<unknown> {
    this.assertOpen();
    if (this.proxy) {
      return this.proxy.schema();
    }
    return this.wasm!.schema();
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
    this.wasm!.free();
    this.wasm = WasmDatabase.importSnapshot(snapshot.data);
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
   * Note: Requires change tracking support in the WASM engine.
   * Currently returns an empty array.
   */
  async changesSince(_timestamp: number): Promise<Change[]> {
    this.assertOpen();
    // TODO: Implement when WASM engine exposes change tracking API
    return [];
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
