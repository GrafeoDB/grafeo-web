/**
 * Web Worker entry point for off-main-thread WASM execution.
 *
 * This file runs inside a dedicated Worker. It loads the WASM module,
 * creates a Database instance, and processes messages from the main thread.
 */
import * as wasmModule from '@grafeo-db/wasm';
import type { Database as DatabaseType } from '@grafeo-db/wasm';
const { Database } = wasmModule;
// wasm-pack --target web exposes an `__wbg_init` default export that must be
// awaited. --target bundler auto-initializes on import and has no default.
const wasmInit: () => Promise<unknown> =
  (wasmModule as { default?: () => Promise<unknown> }).default
    ?? (() => Promise.resolve());

import { PersistenceManager } from './persistence';
import type { WorkerRequest, WorkerResponse } from './types';

let db: DatabaseType | null = null;
let persistence: PersistenceManager | null = null;

function assertWorkerFeature(
  target: DatabaseType,
  methodName: string,
  featureName: string,
): void {
  if (typeof (target as unknown as Record<string, unknown>)[methodName] !== 'function') {
    throw new Error(
      `${methodName}() requires @grafeo-db/wasm built with the '${featureName}' feature`,
    );
  }
}

function respond(id: number, result?: unknown, error?: string): void {
  const message: WorkerResponse = { id };
  if (error !== undefined) {
    message.error = error;
  } else {
    message.result = result;
  }
  self.postMessage(message);
}

async function handleMessage(request: WorkerRequest): Promise<void> {
  const { id, method, args } = request;

  try {
    switch (method) {
      case 'init': {
        // Guard against double-init: free existing resources first
        if (db) {
          if (persistence) {
            await persistence.flush(() => db!.exportSnapshot());
            persistence = null;
          }
          db.free();
          db = null;
        }

        await wasmInit();

        const options = args[0] as { persist?: string; persistInterval?: number } | undefined;
        if (options?.persist) {
          persistence = new PersistenceManager(
            options.persist,
            options.persistInterval,
          );
          const snapshot = await persistence.load();
          if (snapshot) {
            try {
              db = Database.importSnapshot(snapshot);
            } catch (err) {
              console.warn(
                `[grafeo-web] Persisted snapshot for "${options.persist}" is incompatible with this WASM version (likely a storage-format change). Starting with a fresh database.`,
                err,
              );
              db = new Database();
              await persistence.clear();
            }
          } else {
            db = new Database();
          }
        } else {
          db = new Database();
        }

        respond(id, true);
        break;
      }

      case 'version': {
        respond(id, Database.version());
        break;
      }

      case 'execute': {
        if (!db) throw new Error('Database not initialized');
        const query = args[0] as string;
        const options = args[1] as { language?: string; params?: Record<string, unknown> } | undefined;
        const lang = options?.language;
        const params = options?.params;
        const hasLang = lang && lang !== 'gql';

        let result: Record<string, unknown>[];
        if (hasLang && params) {
          result = db.executeWithLanguageAndParams(query, lang, params) as Record<string, unknown>[];
        } else if (hasLang) {
          result = db.executeWithLanguage(query, lang) as Record<string, unknown>[];
        } else if (params) {
          result = db.executeWithParams(query, params) as Record<string, unknown>[];
        } else {
          result = db.execute(query) as Record<string, unknown>[];
        }

        // Always save after execute: detecting mutations from query text is
        // unreliable (e.g. "MATCH (n) DELETE n" misses the mutation keyword).
        // The PersistenceManager debounce makes extra saves on reads harmless.
        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }

        respond(id, result);
        break;
      }

      case 'executeRaw': {
        if (!db) throw new Error('Database not initialized');
        const query = args[0] as string;
        const options = args[1] as { language?: string } | undefined;
        const lang = options?.language;
        const result = lang && lang !== 'gql'
          ? db.executeRawWithLanguage(query, lang)
          : db.executeRaw(query);

        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }

        respond(id, result);
        break;
      }

      case 'nodeCount': {
        if (!db) throw new Error('Database not initialized');
        respond(id, db.nodeCount());
        break;
      }

      case 'edgeCount': {
        if (!db) throw new Error('Database not initialized');
        respond(id, db.edgeCount());
        break;
      }

      case 'export': {
        if (!db) throw new Error('Database not initialized');
        const data = db.exportSnapshot();
        respond(id, { version: 1, data, timestamp: Date.now() });
        break;
      }

      case 'import': {
        if (!db) throw new Error('Database not initialized');
        const snapshot = args[0] as { data: Uint8Array };
        const newDb = Database.importSnapshot(snapshot.data);
        db.free();
        db = newDb;

        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }

        respond(id);
        break;
      }

      case 'schema': {
        if (!db) throw new Error('Database not initialized');
        respond(id, db.schema());
        break;
      }

      case 'clear': {
        if (!db) throw new Error('Database not initialized');
        db.free();
        db = new Database();
        if (persistence) {
          await persistence.clear();
        }
        respond(id);
        break;
      }

      case 'storageStats': {
        if (persistence) {
          const stats = await persistence.storageStats();
          respond(id, stats);
        } else {
          respond(id, { bytesUsed: 0, quota: 0 });
        }
        break;
      }

      case 'createTextIndex': {
        if (!db) throw new Error('Database not initialized');
        const [label, property] = args as [string, string];
        assertWorkerFeature(db, 'createTextIndex', 'text-index');
        db.createTextIndex(label, property);
        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id);
        break;
      }

      case 'dropTextIndex': {
        if (!db) throw new Error('Database not initialized');
        const [label, property] = args as [string, string];
        assertWorkerFeature(db, 'dropTextIndex', 'text-index');
        const existed = db.dropTextIndex(label, property);
        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id, existed);
        break;
      }

      case 'rebuildTextIndex': {
        if (!db) throw new Error('Database not initialized');
        const [label, property] = args as [string, string];
        assertWorkerFeature(db, 'rebuildTextIndex', 'text-index');
        db.rebuildTextIndex(label, property);
        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id);
        break;
      }

      case 'textSearch': {
        if (!db) throw new Error('Database not initialized');
        const [label, property, query, k] = args as [string, string, string, number];
        assertWorkerFeature(db, 'textSearch', 'text-index');
        respond(id, db.textSearch(label, property, query, k));
        break;
      }

      case 'hybridSearch': {
        if (!db) throw new Error('Database not initialized');
        const [label, textProp, vectorProp, queryText, k] = args as [string, string, string, string, number];
        assertWorkerFeature(db, 'hybridSearch', 'hybrid-search');
        respond(id, db.hybridSearch(label, textProp, vectorProp, queryText, k));
        break;
      }

      case 'createVectorIndex': {
        if (!db) throw new Error('Database not initialized');
        const [label, property, options] = args as [string, string, object | undefined];
        assertWorkerFeature(db, 'createVectorIndex', 'vector-index');
        (db as unknown as Record<string, CallableFunction>).createVectorIndex(label, property, options);
        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id);
        break;
      }

      case 'dropVectorIndex': {
        if (!db) throw new Error('Database not initialized');
        const [label, property] = args as [string, string];
        assertWorkerFeature(db, 'dropVectorIndex', 'vector-index');
        const existed = (db as unknown as Record<string, CallableFunction>).dropVectorIndex(label, property) as boolean;
        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id, existed);
        break;
      }

      case 'rebuildVectorIndex': {
        if (!db) throw new Error('Database not initialized');
        const [label, property] = args as [string, string];
        assertWorkerFeature(db, 'rebuildVectorIndex', 'vector-index');
        (db as unknown as Record<string, CallableFunction>).rebuildVectorIndex(label, property);
        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id);
        break;
      }

      case 'vectorSearch': {
        if (!db) throw new Error('Database not initialized');
        const [label, property, query, k, options] = args as [string, string, Float32Array, number, object | undefined];
        assertWorkerFeature(db, 'vectorSearch', 'vector-index');
        const result = (db as unknown as Record<string, CallableFunction>).vectorSearch(label, property, query, k, options);
        respond(id, result);
        break;
      }

      case 'mmrSearch': {
        if (!db) throw new Error('Database not initialized');
        const [label, property, query, k, options] = args as [string, string, Float32Array, number, object | undefined];
        assertWorkerFeature(db, 'mmrSearch', 'vector-index');
        const result = (db as unknown as Record<string, CallableFunction>).mmrSearch(label, property, query, k, options);
        respond(id, result);
        break;
      }

      case 'createProjection': {
        if (!db) throw new Error('Database not initialized');
        const [name, nodeLabels, edgeTypes] = args as [string, string[] | undefined, string[] | undefined];
        const created = db.createProjection(name, nodeLabels, edgeTypes);
        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id, created);
        break;
      }

      case 'dropProjection': {
        if (!db) throw new Error('Database not initialized');
        const projName = args[0] as string;
        const existed = db.dropProjection(projName);
        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id, existed);
        break;
      }

      case 'listProjections': {
        if (!db) throw new Error('Database not initialized');
        respond(id, db.listProjections());
        break;
      }

      case 'setSchema': {
        if (!db) throw new Error('Database not initialized');
        const name = args[0] as string;
        db.setSchema(name);
        respond(id);
        break;
      }

      case 'resetSchema': {
        if (!db) throw new Error('Database not initialized');
        db.resetSchema();
        respond(id);
        break;
      }

      case 'currentSchema': {
        if (!db) throw new Error('Database not initialized');
        respond(id, db.currentSchema());
        break;
      }

      case 'compact': {
        if (!db) throw new Error('Database not initialized');
        assertWorkerFeature(db, 'compact', 'compact-store');
        (db as unknown as { compact(): void }).compact();
        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id);
        break;
      }

      case 'clearPlanCache': {
        if (!db) throw new Error('Database not initialized');
        db.clearPlanCache();
        respond(id);
        break;
      }

      case 'memoryUsage': {
        if (!db) throw new Error('Database not initialized');
        respond(id, db.memoryUsage());
        break;
      }

      case 'info': {
        if (!db) throw new Error('Database not initialized');
        respond(id, db.info());
        break;
      }

      case 'importRows': {
        if (!db) throw new Error('Database not initialized');
        const [rows, options] = args as [object[], object];
        const count = db.importRows(rows, options);
        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id, count);
        break;
      }

      case 'importLpg': {
        if (!db) throw new Error('Database not initialized');
        const data = args[0] as { nodes: unknown[]; edges: unknown[] };
        const result = (db as unknown as Record<string, CallableFunction>).importLpg(data);
        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id, result);
        break;
      }

      case 'importRdf': {
        if (!db) throw new Error('Database not initialized');
        assertWorkerFeature(db, 'importRdf', 'rdf');
        const data = args[0] as { triples: unknown[] };
        const result = (db as unknown as Record<string, CallableFunction>).importRdf(data);
        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id, result);
        break;
      }

      case 'beginTransaction': {
        if (!db) throw new Error('Database not initialized');
        // Cancel any pending pre-tx save so its timer cannot fire mid-tx and
        // capture uncommitted state via exportSnapshot() at fire time.
        persistence?.cancel();
        db.beginTransaction();
        respond(id);
        break;
      }

      case 'commitTransaction': {
        if (!db) throw new Error('Database not initialized');
        db.commitTransaction();
        if (persistence) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id);
        break;
      }

      case 'rollbackTransaction': {
        if (!db) throw new Error('Database not initialized');
        db.rollbackTransaction();
        // After rollback the in-memory state == pre-tx state, so a single
        // post-rollback scheduleSave is sufficient: it persists the rolled-back
        // state, which equals pre-tx state.
        if (persistence) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id);
        break;
      }

      case 'isTransactionActive': {
        if (!db) throw new Error('Database not initialized');
        respond(id, db.isTransactionActive());
        break;
      }

      case 'signedExport': {
        if (!db) throw new Error('Database not initialized');
        const key = args[0] as Uint8Array;
        respond(id, db.exportSnapshotSigned(key));
        break;
      }

      case 'signedImport': {
        if (!db) throw new Error('Database not initialized');
        const [data, key] = args as [Uint8Array, Uint8Array];
        const newDb = Database.importSnapshotSigned(data, key);
        db.free();
        db = newDb;
        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id);
        break;
      }

      case 'close': {
        if (persistence && db) {
          await persistence.flush(() => db!.exportSnapshot());
          persistence = null;
        }
        if (db) {
          db.free();
          db = null;
        }
        respond(id);
        break;
      }

      default:
        respond(id, undefined, `Unknown method: ${method}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    respond(id, undefined, message);
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  handleMessage(event.data);
};
