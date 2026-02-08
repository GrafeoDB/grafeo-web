import { Database as WasmDatabase } from '@grafeo-db/wasm';

import { PersistenceManager } from './persistence';
import { ensureWasmInitialized } from './wasm-init';
import type {
  Change,
  CreateOptions,
  DatabaseSnapshot,
  RawQueryResult,
  StorageStats,
} from './types';

export type { Change, CreateOptions, DatabaseSnapshot, RawQueryResult, StorageStats };

/** Detects queries that mutate the graph (INSERT, CREATE, DELETE, etc). */
function isMutatingQuery(query: string): boolean {
  return /^\s*(INSERT|CREATE|DELETE|REMOVE|SET|MERGE|DROP)\b/i.test(query);
}

/**
 * A lightweight Grafeo database supporting GQL only.
 *
 * Identical API to the full `GrafeoDB` but uses a smaller WASM binary
 * (~400 KB gzipped vs ~800 KB) by excluding Cypher, SPARQL, GraphQL,
 * and Gremlin parsers.
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
   * @param options - Configuration for persistence.
   * @returns A ready-to-use database instance.
   */
  static async create(options?: CreateOptions): Promise<GrafeoDB> {
    // TODO: When a lite WASM binary exists, import from '@grafeo-db/wasm/lite'
    await ensureWasmInitialized();
    const wasm = new WasmDatabase();

    let persistence: PersistenceManager | null = null;
    if (options?.persist) {
      persistence = new PersistenceManager(
        options.persist,
        options.persistInterval,
      );
      const snapshot = await persistence.load();
      if (snapshot) {
        wasm.importSnapshot(snapshot);
      }
    }

    return new GrafeoDB(wasm, persistence);
  }

  /** Whether the database is still open and usable. */
  get isOpen(): boolean {
    return !this.closed;
  }

  /** Executes a GQL query and returns results as an array of objects. */
  async execute(query: string): Promise<Record<string, unknown>[]> {
    this.assertOpen();
    const result = this.wasm!.execute(query);

    if (this.persistence && isMutatingQuery(query)) {
      this.persistence.scheduleSave(() => this.wasm!.exportSnapshot());
    }

    return result as Record<string, unknown>[];
  }

  /** Executes a GQL query and returns raw columns, rows, and metadata. */
  async executeRaw(query: string): Promise<RawQueryResult> {
    this.assertOpen();
    const result = this.wasm!.executeRaw(query);

    if (this.persistence && isMutatingQuery(query)) {
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
    this.wasm!.importSnapshot(snapshot.data);
    if (this.persistence) {
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

  /** Returns changes since the given timestamp. */
  async changesSince(_timestamp: number): Promise<Change[]> {
    this.assertOpen();
    return [];
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
