/**
 * Web Worker entry point for off-main-thread WASM execution.
 *
 * This file runs inside a dedicated Worker. It loads the WASM module,
 * creates a Database instance, and processes messages from the main thread.
 */
import init, { Database } from '@grafeo-db/wasm';

import { PersistenceManager } from './persistence';
import { isMutatingQuery } from './query-utils';
import type { WorkerRequest, WorkerResponse } from './types';

let db: Database | null = null;
let persistence: PersistenceManager | null = null;

function assertWorkerFeature(
  target: Database,
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
        await init();

        const options = args[0] as { persist?: string; persistInterval?: number } | undefined;
        if (options?.persist) {
          persistence = new PersistenceManager(
            options.persist,
            options.persistInterval,
          );
          const snapshot = await persistence.load();
          db = snapshot
            ? Database.importSnapshot(snapshot)
            : new Database();
        } else {
          db = new Database();
        }

        respond(id, true);
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

        if (persistence && isMutatingQuery(query)) {
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

        if (persistence && isMutatingQuery(query)) {
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
        db.free();
        db = Database.importSnapshot(snapshot.data);

        if (persistence) {
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
        if (persistence) {
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
        if (persistence) {
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
        if (persistence) {
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

      case 'importLpg': {
        if (!db) throw new Error('Database not initialized');
        const data = args[0] as { nodes: unknown[]; edges: unknown[] };
        const result = (db as unknown as Record<string, CallableFunction>).importLpg(data);
        if (persistence) {
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
        if (persistence) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }
        respond(id, result);
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
