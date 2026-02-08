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
        const options = args[1] as { language?: string } | undefined;
        const lang = options?.language;
        const result = lang && lang !== 'gql'
          ? db.executeWithLanguage(query, lang)
          : db.execute(query);

        if (persistence && isMutatingQuery(query)) {
          persistence.scheduleSave(() => db!.exportSnapshot());
        }

        respond(id, result);
        break;
      }

      case 'executeRaw': {
        if (!db) throw new Error('Database not initialized');
        const query = args[0] as string;
        const result = db.executeRaw(query);

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
