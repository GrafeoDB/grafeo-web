import { GrafeoDB } from './index';
import type { CreateOptions, ExecuteOptions } from './types';

export type { CreateOptions, ExecuteOptions };

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

export interface CreateQueryResult<T = Record<string, unknown>[]> {
  data: Readable<T | null>;
  loading: Readable<boolean>;
  error: Readable<Error | null>;
  refetch: () => void;
}

/**
 * Creates Svelte stores for running a reactive query against a GrafeoDB instance.
 *
 * Re-executes the query whenever the database store emits a new value or `refetch` is called.
 *
 * @example
 * ```svelte
 * <script>
 * import { createGrafeo, createQuery } from '@grafeo-db/web/svelte';
 * const { db } = createGrafeo({ persist: 'mydb' });
 * const { data, loading } = createQuery(db, "MATCH (p:Person) RETURN p.name");
 * </script>
 *
 * {#if $loading}Loading...{/if}
 * {#each $data ?? [] as row}
 *   <p>{row['p.name']}</p>
 * {/each}
 * ```
 */
export function createQuery<T = Record<string, unknown>[]>(
  db: Readable<GrafeoDB | null>,
  query: string,
  options?: ExecuteOptions,
): CreateQueryResult<T> {
  const dataSubscribers = new Set<(value: T | null) => void>();
  const loadingSubscribers = new Set<(value: boolean) => void>();
  const errorSubscribers = new Set<(value: Error | null) => void>();

  let currentData: T | null = null;
  let currentLoading = true;
  let currentError: Error | null = null;
  let currentDb: GrafeoDB | null = null;
  let version = 0;

  function notifyData(): void {
    for (const fn of dataSubscribers) fn(currentData);
  }
  function notifyLoading(): void {
    for (const fn of loadingSubscribers) fn(currentLoading);
  }
  function notifyError(): void {
    for (const fn of errorSubscribers) fn(currentError);
  }

  async function executeQuery(): Promise<void> {
    if (!currentDb) {
      currentLoading = true;
      notifyLoading();
      return;
    }

    currentLoading = true;
    currentError = null;
    notifyLoading();
    notifyError();

    try {
      const result = await currentDb.execute(query, options);
      currentData = result as T;
      notifyData();
    } catch (err: unknown) {
      currentError = err instanceof Error ? err : new Error(String(err));
      notifyError();
    } finally {
      currentLoading = false;
      notifyLoading();
    }
  }

  // Subscribe to db store changes
  const unsubscribeDb = db.subscribe((database) => {
    currentDb = database;
    executeQuery();
  });

  const data: Readable<T | null> = {
    subscribe(fn) {
      dataSubscribers.add(fn);
      fn(currentData);
      return () => {
        dataSubscribers.delete(fn);
        if (dataSubscribers.size === 0 && loadingSubscribers.size === 0 && errorSubscribers.size === 0) {
          unsubscribeDb();
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
        if (dataSubscribers.size === 0 && loadingSubscribers.size === 0 && errorSubscribers.size === 0) {
          unsubscribeDb();
        }
      };
    },
  };

  const error: Readable<Error | null> = {
    subscribe(fn) {
      errorSubscribers.add(fn);
      fn(currentError);
      return () => {
        errorSubscribers.delete(fn);
        if (dataSubscribers.size === 0 && loadingSubscribers.size === 0 && errorSubscribers.size === 0) {
          unsubscribeDb();
        }
      };
    },
  };

  function refetch(): void {
    version++;
    executeQuery();
  }

  return { data, loading, error, refetch };
}
