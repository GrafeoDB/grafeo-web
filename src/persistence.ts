import type { StorageStats } from './types';

const DB_NAME = 'grafeo-web';
const STORE_NAME = 'snapshots';
const DB_VERSION = 1;
const DEFAULT_PERSIST_INTERVAL = 1000;

interface SnapshotRecord {
  key: string;
  snapshot: Uint8Array;
  timestamp: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Manages IndexedDB persistence for a GrafeoDB instance.
 *
 * Handles debounced snapshot writes and restore-on-load.
 */
export class PersistenceManager {
  private key: string;
  private interval: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private onError: (error: Error) => void;

  constructor(
    key: string,
    interval?: number,
    onError?: (error: Error) => void,
  ) {
    this.key = key;
    this.interval = interval ?? DEFAULT_PERSIST_INTERVAL;
    this.onError = onError ?? ((err) => console.error('[grafeo-web] persistence error:', err));
  }

  /** Load a previously persisted snapshot. Returns null if none exists. */
  async load(): Promise<Uint8Array | null> {
    const db = await openDatabase();
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const record = await idbRequest<SnapshotRecord | undefined>(
        store.get(this.key),
      );
      return record?.snapshot ?? null;
    } finally {
      db.close();
    }
  }

  /** Save a snapshot to IndexedDB. */
  async save(snapshot: Uint8Array): Promise<void> {
    const db = await openDatabase();
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record: SnapshotRecord = {
        key: this.key,
        snapshot,
        timestamp: Date.now(),
      };
      await idbRequest(store.put(record));
    } finally {
      db.close();
    }
  }

  /**
   * Schedule a debounced save. The `getSnapshot` callback is called
   * when the debounce timer fires to get the latest state.
   */
  scheduleSave(getSnapshot: () => Uint8Array): void {
    this.dirty = true;

    if (this.timer !== null) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(async () => {
      this.timer = null;
      if (this.dirty) {
        this.dirty = false;
        try {
          const snapshot = getSnapshot();
          await this.save(snapshot);
        } catch (err) {
          this.onError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    }, this.interval);
  }

  /** Flush any pending save immediately. */
  async flush(getSnapshot: () => Uint8Array): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirty) {
      this.dirty = false;
      const snapshot = getSnapshot();
      await this.save(snapshot);
    }
  }

  /** Delete the persisted snapshot for this key. */
  async clear(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.dirty = false;

    const db = await openDatabase();
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      await idbRequest(store.delete(this.key));
    } finally {
      db.close();
    }
  }

  /** Get storage usage statistics. */
  async storageStats(): Promise<StorageStats> {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        bytesUsed: estimate.usage ?? 0,
        quota: estimate.quota ?? 0,
      };
    }
    return { bytesUsed: 0, quota: 0 };
  }
}
