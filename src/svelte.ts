const PLACEHOLDER_MESSAGE =
  '@grafeo-db/web/svelte is not yet released. Follow https://github.com/GrafeoDB/grafeo-web for updates.';

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

export interface Readable<T> {
  subscribe(fn: (value: T) => void): () => void;
}

export interface CreateGrafeoResult {
  db: Readable<GrafeoDB | null>;
  loading: Readable<boolean>;
  error: Readable<Error | null>;
}

export function createGrafeo(_options?: CreateOptions): CreateGrafeoResult {
  placeholder();
}
