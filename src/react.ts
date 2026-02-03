const PLACEHOLDER_MESSAGE =
  '@grafeo-db/web/react is not yet released. Follow https://github.com/GrafeoDB/grafeo-web for updates.';

function placeholder(): never {
  throw new Error(PLACEHOLDER_MESSAGE);
}

export interface CreateOptions {
  persist?: string;
  worker?: boolean;
}

export interface GrafeoDB {
  execute(query: string): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

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

export function useGrafeo(_options?: CreateOptions): UseGrafeoResult {
  placeholder();
}

export function useQuery<T = Record<string, unknown>[]>(
  _db: GrafeoDB | null,
  _query: string
): UseQueryResult<T> {
  placeholder();
}
