/**
 * Web Worker entry point for off-main-thread WASM execution.
 *
 * This file runs inside a dedicated Worker. It loads the WASM module,
 * creates a Database instance, and processes messages from the main thread.
 *
 * The message handler is installed synchronously, before the engine loads.
 * The engine is a dynamic `import()`: a static import would hold back the
 * whole module, handler included, until the WASM is fetched and compiled
 * (Vite turns the package's `.wasm` import into a top-level await), and a
 * message posted right after `new Worker()` would be lost. Messages are
 * queued and run one at a time, in arrival order, once the engine is ready.
 */
import type { Database as DatabaseType } from '@grafeo-db/wasm';

import { assertCompactWorks } from './engine-quirks';
import { PersistenceManager, openPersisted } from './persistence';
import type { WorkerRequest, WorkerResponse } from './types';

type Engine = typeof import('@grafeo-db/wasm');

let enginePromise: Promise<Engine> | null = null;
let Database: Engine['Database'];

/** Loads and initializes the engine once; a failed load is retried by the next message. */
function loadEngine(): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = import('@grafeo-db/wasm').then(async (module) => {
      // wasm-pack --target web exposes an `__wbg_init` default export that must
      // be awaited. --target bundler initializes on import and has no default.
      const init = (module as { default?: () => Promise<unknown> }).default;
      if (typeof init === 'function') {
        await init();
      }
      return module;
    });
    enginePromise.catch(() => {
      enginePromise = null;
    });
  }
  return enginePromise;
}

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

function respond(
  id: number,
  result?: unknown,
  error?: string,
  errorInfo?: WorkerResponse['errorInfo'],
): void {
  const message: WorkerResponse = { id };
  if (error !== undefined) {
    message.error = error;
    if (errorInfo) message.errorInfo = errorInfo;
  } else {
    message.result = result;
  }
  self.postMessage(message);
}

/** The fields of an error that survive the trip to the main thread besides its message. */
function errorInfoOf(error: unknown): WorkerResponse['errorInfo'] {
  if (!(error instanceof Error)) return undefined;
  const info: NonNullable<WorkerResponse['errorInfo']> = {};
  if (error.name && error.name !== 'Error') info.name = error.name;
  const gqlStatus = (error as { gqlStatus?: unknown }).gqlStatus;
  if (typeof gqlStatus === 'string') info.gqlStatus = gqlStatus;
  return Object.keys(info).length > 0 ? info : undefined;
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

        const options = args[0] as { persist?: string; persistInterval?: number } | undefined;
        if (options?.persist) {
          persistence = new PersistenceManager(
            options.persist,
            options.persistInterval,
          );
          db = await openPersisted(
            options.persist,
            persistence,
            Database.version(),
            (snapshot) => Database.importSnapshot(snapshot),
            () => new Database(),
          );
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
        const options = args[1] as { language?: string; params?: Record<string, unknown> } | undefined;
        const lang = options?.language;
        const params = options?.params;
        const hasLang = lang && lang !== 'gql';

        let result;
        if (hasLang && params) {
          result = db.executeRawWithLanguageAndParams(query, lang, params);
        } else if (hasLang) {
          result = db.executeRawWithLanguage(query, lang);
        } else if (params) {
          result = db.executeRawWithParams(query, params);
        } else {
          result = db.executeRaw(query);
        }

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

      case 'getNodeEdges': {
        if (!db) throw new Error('Database not initialized');
        const [nodeId, options] = args as [number, object | undefined];
        respond(id, db.getNodeEdges(nodeId, options));
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
        const [label, property, options] = args as [string, string, object | undefined];
        assertWorkerFeature(db, 'createTextIndex', 'text-index');
        db.createTextIndex(label, property, options);
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
        const [label, property, query, k, options] = args as [string, string, string, number, object | undefined];
        assertWorkerFeature(db, 'textSearch', 'text-index');
        respond(id, db.textSearch(label, property, query, k, options));
        break;
      }

      case 'hybridSearch': {
        if (!db) throw new Error('Database not initialized');
        const [label, textProp, vectorProp, queryText, k, options] = args as [
          string, string, string, string, number, object | undefined,
        ];
        assertWorkerFeature(db, 'hybridSearch', 'hybrid-search');
        respond(id, db.hybridSearch(label, textProp, vectorProp, queryText, k, options));
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

      case 'batchVectorSearch': {
        if (!db) throw new Error('Database not initialized');
        const [label, property, queries, k, options] = args as [
          string, string, (Float32Array | number[])[], number, object | undefined,
        ];
        assertWorkerFeature(db, 'batchVectorSearch', 'vector-index');
        respond(id, db.batchVectorSearch(label, property, queries, k, options));
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
        assertCompactWorks(Database.version());
        const report = db.compact();
        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id, report);
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

      case 'batchCreateNodesWithProps': {
        if (!db) throw new Error('Database not initialized');
        const [labels, rows] = args as [string | string[], object[]];
        assertWorkerFeature(db, 'batchCreateNodesWithProps', 'direct-api');
        const ids = db.batchCreateNodesWithProps(labels, rows);
        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id, ids);
        break;
      }

      case 'batchCreateEdges': {
        if (!db) throw new Error('Database not initialized');
        const edges = args[0] as object[];
        assertWorkerFeature(db, 'batchCreateEdges', 'direct-api');
        const ids = db.batchCreateEdges(edges);
        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id, ids);
        break;
      }

      case 'upsertNodes': {
        if (!db) throw new Error('Database not initialized');
        const [labels, rows, options] = args as [string | string[], object[], object | undefined];
        assertWorkerFeature(db, 'upsertNodes', 'direct-api');
        const summary = db.upsertNodes(labels, rows, options);
        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id, summary);
        break;
      }

      case 'upsertEdges': {
        if (!db) throw new Error('Database not initialized');
        const [edgeType, rows, options] = args as [string, object[], object | undefined];
        assertWorkerFeature(db, 'upsertEdges', 'direct-api');
        const summary = db.upsertEdges(edgeType, rows, options);
        if (persistence && !db!.isTransactionActive()) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id, summary);
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
    respond(id, undefined, message, errorInfoOf(error));
  }
}

/** Waits for the engine, then handles one request. */
async function run(request: WorkerRequest): Promise<void> {
  let engine: Engine;
  try {
    engine = await loadEngine();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    respond(request.id, undefined, `Failed to load the Grafeo engine: ${message}`);
    return;
  }
  Database = engine.Database;
  await handleMessage(request);
}

let queue: Promise<void> = Promise.resolve();

// Installed before the engine loads, so no message is lost; see the top of this file.
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  queue = queue.then(() => run(request)).catch(() => undefined);
};
