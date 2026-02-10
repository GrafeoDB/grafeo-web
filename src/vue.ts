import { onUnmounted, ref, watch, type Ref } from 'vue';

import { GrafeoDB } from './index';
import type { CreateOptions, ExecuteOptions } from './types';

export type { CreateOptions, ExecuteOptions };

export interface UseGrafeoResult {
  db: Ref<GrafeoDB | null>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
}

export interface UseQueryResult<T = Record<string, unknown>[]> {
  data: Ref<T | null>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
  refetch: () => void;
}

/**
 * Vue composable for managing a GrafeoDB lifecycle.
 *
 * Creates a database during setup and closes it on unmount.
 *
 * @example
 * ```vue
 * <script setup>
 * import { useGrafeo, useQuery } from '@grafeo-db/web/vue';
 * const { db, loading } = useGrafeo({ persist: 'mydb' });
 * </script>
 * ```
 */
export function useGrafeo(options?: CreateOptions): UseGrafeoResult {
  const db = ref<GrafeoDB | null>(null);
  const loading = ref(true);
  const error = ref<Error | null>(null);

  GrafeoDB.create(options)
    .then((created) => {
      db.value = created;
      loading.value = false;
    })
    .catch((err: unknown) => {
      error.value = err instanceof Error ? err : new Error(String(err));
      loading.value = false;
    });

  onUnmounted(() => {
    db.value?.close();
  });

  return { db: db as Ref<GrafeoDB | null>, loading, error };
}

/**
 * Vue composable for running a reactive query against a GrafeoDB instance.
 *
 * Re-executes the query whenever the database ref or query changes.
 *
 * @example
 * ```vue
 * <script setup>
 * const { db } = useGrafeo();
 * const { data } = useQuery(db, "MATCH (p:Person) RETURN p.name");
 * </script>
 * ```
 */
export function useQuery<T = Record<string, unknown>[]>(
  db: Ref<GrafeoDB | null>,
  query: string,
  options?: ExecuteOptions,
): UseQueryResult<T> {
  const data = ref<T | null>(null) as Ref<T | null>;
  const loading = ref(true);
  const error = ref<Error | null>(null);
  const version = ref(0);

  const refetch = (): void => {
    version.value++;
  };

  watch(
    [db, () => query, version],
    async () => {
      const database = db.value;
      if (!database) {
        loading.value = true;
        return;
      }

      loading.value = true;
      error.value = null;

      try {
        const result = await database.execute(query, options);
        data.value = result as T;
      } catch (err: unknown) {
        error.value = err instanceof Error ? err : new Error(String(err));
      } finally {
        loading.value = false;
      }
    },
    { immediate: true },
  );

  return { data, loading, error, refetch };
}
