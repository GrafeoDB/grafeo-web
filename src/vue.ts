const PLACEHOLDER_MESSAGE =
  '@grafeo-db/web/vue is not yet released. Follow https://github.com/GrafeoDB/grafeo-web for updates.';

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

export interface Ref<T> {
  value: T;
}

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

export function useGrafeo(_options?: CreateOptions): UseGrafeoResult {
  placeholder();
}

export function useQuery<T = Record<string, unknown>[]>(
  _db: Ref<GrafeoDB | null>,
  _query: string
): UseQueryResult<T> {
  placeholder();
}
