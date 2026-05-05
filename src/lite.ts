import { Database as WasmDatabase } from '@grafeo-db/wasm-lite';

import { PersistenceManager } from './persistence';
import { ensureLiteWasmInitialized } from './wasm-init-lite';
import type {
  Change,
  DatabaseInfo,
  DatabaseSnapshot,
  LiteCreateOptions,
  LiteExecuteOptions,
  RawQueryResult,
  SchemaInfo,
  SchemaLabel,
  StorageStats,
} from './types';

export type { Change, DatabaseInfo, DatabaseSnapshot, LiteCreateOptions, LiteExecuteOptions, RawQueryResult, SchemaInfo, SchemaLabel, StorageStats };

/**
 * A lightweight Grafeo database supporting GQL only.
 *
 * Identical API to the full `GrafeoDB` but uses a smaller WASM binary
 * (~507 KB gzipped vs ~600 KB) by excluding AI search features,
 * Cypher, SPARQL, GraphQL, and Gremlin parsers.
 *
 * @example
 * ```typescript
 * import { GrafeoDB } from '@grafeo-db/web/lite';
 * const db = await GrafeoDB.create();
 * const result = await db.execute("MATCH (n) RETURN n");
 * ```
 */
export class GrafeoDB {
  private wasm: WasmDatabase | null;
  private persistence: PersistenceManager | null;
  private closed = false;

  private constructor(
    wasm: WasmDatabase,
    persistence: PersistenceManager | null,
  ) {
    this.wasm = wasm;
    this.persistence = persistence;
  }

  /**
   * Creates a new GrafeoDB lite instance (GQL only).
   *
   * @param options - Configuration for persistence. Worker mode is not supported in the lite build.
   * @returns A ready-to-use database instance.
   */
  static async create(options?: LiteCreateOptions): Promise<GrafeoDB> {
    await ensureLiteWasmInitialized();

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

    return new GrafeoDB(wasm, persistence);
  }

  /** Whether the database is still open and usable. */
  get isOpen(): boolean {
    return !this.closed;
  }

  /** Executes a GQL query and returns results as an array of objects. */
  async execute<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    options?: LiteExecuteOptions,
  ): Promise<T[]> {
    this.assertOpen();
    const params = options?.params;
    const result = params
      ? this.wasm!.executeWithParams(query, params)
      : this.wasm!.execute(query);

    if (this.persistence && !this.wasm!.isTransactionActive()) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }

    return result as T[];
  }

  /** Executes a GQL query and returns raw columns, rows, and metadata. */
  async executeRaw(query: string): Promise<RawQueryResult> {
    this.assertOpen();
    const result = this.wasm!.executeRaw(query);

    if (this.persistence && !this.wasm!.isTransactionActive()) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }

    return result as RawQueryResult;
  }

  /** Returns the number of nodes in the database. */
  async nodeCount(): Promise<number> {
    this.assertOpen();
    return this.wasm!.nodeCount();
  }

  /** Returns the number of edges in the database. */
  async edgeCount(): Promise<number> {
    this.assertOpen();
    return this.wasm!.edgeCount();
  }

  /** Returns schema information (labels, edge types, property keys). */
  async schema(): Promise<SchemaInfo> {
    this.assertOpen();
    return this.wasm!.schema() as SchemaInfo;
  }

  /**
   * Creates a named graph projection (a read-only filtered view of the graph).
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
    const created = this.wasm!.createProjection(name, nodeLabels, edgeTypes);
    if (this.persistence && !this.wasm!.isTransactionActive()) {
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
    const existed = this.wasm!.dropProjection(name);
    if (this.persistence && !this.wasm!.isTransactionActive()) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
    return existed;
  }

  /** Returns the names of all active graph projections. */
  async listProjections(): Promise<string[]> {
    this.assertOpen();
    return this.wasm!.listProjections();
  }

  /** Sets the current schema context for subsequent queries. */
  async setSchema(name: string): Promise<void> {
    this.assertOpen();
    this.wasm!.setSchema(name);
  }

  /** Clears the current schema context. */
  async resetSchema(): Promise<void> {
    this.assertOpen();
    this.wasm!.resetSchema();
  }

  /** Returns the current schema name, or undefined if none is set. */
  async currentSchema(): Promise<string | undefined> {
    this.assertOpen();
    return this.wasm!.currentSchema();
  }

  /** Clears the query plan cache. */
  async clearPlanCache(): Promise<void> {
    this.assertOpen();
    this.wasm!.clearPlanCache();
  }

  /** Returns high-level database information (counts, mode, compiled features). */
  async info(): Promise<DatabaseInfo> {
    this.assertOpen();
    return this.wasm!.info() as DatabaseInfo;
  }

  /** Returns IndexedDB storage usage statistics. */
  async storageStats(): Promise<StorageStats> {
    this.assertOpen();
    if (this.persistence) {
      return this.persistence.storageStats();
    }
    return { bytesUsed: 0, quota: 0 };
  }

  /** Exports the full database state as a snapshot. */
  async export(): Promise<DatabaseSnapshot> {
    this.assertOpen();
    const data = this.wasm!.exportSnapshot();
    return { version: 1, data, timestamp: Date.now() };
  }

  /** Restores the database from a previously exported snapshot. */
  async import(snapshot: DatabaseSnapshot): Promise<void> {
    this.assertOpen();
    const newWasm = WasmDatabase.importSnapshot(snapshot.data);
    this.wasm!.free();
    this.wasm = newWasm;
    if (this.persistence && !this.wasm!.isTransactionActive()) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
  }

  /** Deletes all data from the database and IndexedDB (if persisted). */
  async clear(): Promise<void> {
    this.assertOpen();
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

  /**
   * Begins a new transaction. Subsequent `execute*` calls see each other's
   * uncommitted writes until `commitTransaction()` or `rollbackTransaction()`.
   */
  async beginTransaction(): Promise<void> {
    this.assertOpen();
    // Cancel any pending pre-tx save so its timer cannot fire mid-tx and
    // capture uncommitted state via exportSnapshot() at fire time.
    this.persistence?.cancel();
    this.wasm!.beginTransaction();
  }

  /** Commits the active transaction. Persists writes if the database is persistent. */
  async commitTransaction(): Promise<void> {
    this.assertOpen();
    this.wasm!.commitTransaction();
    if (this.persistence) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
  }

  /** Rolls back the active transaction, discarding pending writes. */
  async rollbackTransaction(): Promise<void> {
    this.assertOpen();
    this.wasm!.rollbackTransaction();
    // After rollback the in-memory state == pre-tx state, so a single
    // post-rollback scheduleSave is sufficient: it persists the rolled-back
    // state, which equals pre-tx state.
    if (this.persistence) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
  }

  /** Returns true while a transaction is active. */
  async isTransactionActive(): Promise<boolean> {
    this.assertOpen();
    return this.wasm!.isTransactionActive();
  }

  /**
   * Exports a tamper-evident snapshot: prefixed with a `GSN1` magic header
   * and an HMAC-SHA256 tag computed with `key`. Restore with `signedImport()`
   * using the same `key`.
   */
  async signedExport(key: Uint8Array): Promise<Uint8Array> {
    this.assertOpen();
    return this.wasm!.exportSnapshotSigned(key);
  }

  /**
   * Restores from a signed snapshot produced by `signedExport()`. Verifies
   * the HMAC tag in constant time; throws if the data is truncated, signed
   * with a different key, or missing the `GSN1` header.
   */
  async signedImport(data: Uint8Array, key: Uint8Array): Promise<void> {
    this.assertOpen();
    const newWasm = WasmDatabase.importSnapshotSigned(data, key);
    this.wasm!.free();
    this.wasm = newWasm;
    if (this.persistence && !this.wasm!.isTransactionActive()) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }
  }

  /** Releases WASM memory and closes any open resources. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

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
}
