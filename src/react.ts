import { useCallback, useEffect, useRef, useState } from 'react';

import { GrafeoDB } from './index';
import type { CreateOptions, ExecuteOptions } from './types';

export type { CreateOptions, ExecuteOptions };

export interface UseGrafeoResult {
  db: GrafeoDB | null;
  loading: boolean;
  error: Error | null;
}

export interface UseQueryResult<T = Record<string, unknown>[]> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * React hook for managing a GrafeoDB lifecycle.
 *
 * Creates a database on mount and closes it on unmount.
 *
 * @example
 * ```tsx
 * const { db, loading, error } = useGrafeo({ persist: 'mydb' });
 * if (loading) return <p>Loading...</p>;
 * if (error) return <p>Error: {error.message}</p>;
 * ```
 */
export function useGrafeo(options?: CreateOptions): UseGrafeoResult {
  const [db, setDb] = useState<GrafeoDB | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let instance: GrafeoDB | null = null;

    GrafeoDB.create(options)
      .then((created) => {
        instance = created;
        if (mountedRef.current) {
          setDb(created);
          setLoading(false);
        } else {
          created.close();
        }
      })
      .catch((err: unknown) => {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });

    return () => {
      mountedRef.current = false;
      instance?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { db, loading, error };
}

/**
 * React hook for running a reactive query against a GrafeoDB instance.
 *
 * Re-executes the query whenever `db` or `query` changes.
 *
 * @example
 * ```tsx
 * const { db } = useGrafeo();
 * const { data, loading, refetch } = useQuery(db, "MATCH (p:Person) RETURN p.name");
 * ```
 */
export function useQuery<T = Record<string, unknown>[]>(
  db: GrafeoDB | null,
  query: string,
  options?: ExecuteOptions,
): UseQueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);
  const mountedRef = useRef(true);

  const refetch = useCallback(() => {
    setVersion((v: number) => v + 1);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (!db) {
      setLoading(true);
      return;
    }

    setLoading(true);
    setError(null);

    db.execute(query, options)
      .then((result) => {
        if (mountedRef.current) {
          setData(result as T);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });

    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, query, version]);

  return { data, loading, error, refetch };
}
