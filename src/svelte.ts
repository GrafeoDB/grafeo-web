import { GrafeoDB } from './index';
import type { CreateOptions } from './types';

export type { CreateOptions };

/** Svelte-compatible readable store interface. */
export interface Readable<T> {
  subscribe(fn: (value: T) => void): () => void;
}

export interface CreateGrafeoResult {
  db: Readable<GrafeoDB | null>;
  loading: Readable<boolean>;
  error: Readable<Error | null>;
  /** Close the database and clean up resources. */
  close: () => Promise<void>;
}

/**
 * Creates Svelte stores that manage a GrafeoDB lifecycle.
 *
 * Returns readable stores for db, loading, and error states.
 * The database closes automatically when the last db subscriber leaves.
 *
 * @example
 * ```svelte
 * <script>
 * import { createGrafeo } from '@grafeo-db/web/svelte';
 * const { db, loading, error } = createGrafeo({ persist: 'mydb' });
 * </script>
 *
 * {#if $loading}Loading...{/if}
 * {#if $error}Error: {$error.message}{/if}
 * ```
 */
export function createGrafeo(options?: CreateOptions): CreateGrafeoResult {
  let instance: GrafeoDB | null = null;
  const dbSubscribers = new Set<(value: GrafeoDB | null) => void>();
  const loadingSubscribers = new Set<(value: boolean) => void>();
  const errorSubscribers = new Set<(value: Error | null) => void>();

  let currentDb: GrafeoDB | null = null;
  let currentLoading = true;
  let currentError: Error | null = null;

  function notifyDb(): void {
    for (const fn of dbSubscribers) fn(currentDb);
  }
  function notifyLoading(): void {
    for (const fn of loadingSubscribers) fn(currentLoading);
  }
  function notifyError(): void {
    for (const fn of errorSubscribers) fn(currentError);
  }

  // Start loading immediately
  GrafeoDB.create(options)
    .then((created) => {
      instance = created;
      currentDb = created;
      currentLoading = false;
      notifyDb();
      notifyLoading();
    })
    .catch((err: unknown) => {
      currentError = err instanceof Error ? err : new Error(String(err));
      currentLoading = false;
      notifyError();
      notifyLoading();
    });

  const db: Readable<GrafeoDB | null> = {
    subscribe(fn) {
      dbSubscribers.add(fn);
      fn(currentDb);
      return () => {
        dbSubscribers.delete(fn);
        // Auto-close when last db subscriber leaves
        if (dbSubscribers.size === 0 && instance) {
          instance.close();
          instance = null;
          currentDb = null;
        }
      };
    },
  };

  const loading: Readable<boolean> = {
    subscribe(fn) {
      loadingSubscribers.add(fn);
      fn(currentLoading);
      return () => {
        loadingSubscribers.delete(fn);
      };
    },
  };

  const error: Readable<Error | null> = {
    subscribe(fn) {
      errorSubscribers.add(fn);
      fn(currentError);
      return () => {
        errorSubscribers.delete(fn);
      };
    },
  };

  async function close(): Promise<void> {
    if (instance) {
      await instance.close();
      instance = null;
      currentDb = null;
      notifyDb();
    }
  }

  return { db, loading, error, close };
}
