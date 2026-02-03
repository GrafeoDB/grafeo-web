const PLACEHOLDER_MESSAGE =
  '@grafeo-db/web is not yet released. Follow https://github.com/GrafeoDB/grafeo-web for updates.';

function placeholder(): never {
  throw new Error(PLACEHOLDER_MESSAGE);
}

export type QueryLanguage = 'gql' | 'cypher' | 'sparql' | 'graphql' | 'gremlin';

export interface CreateOptions {
  persist?: string;
  worker?: boolean;
}

export interface ExecuteOptions {
  language?: QueryLanguage;
}

export interface StorageStats {
  bytesUsed: number;
  quota: number;
}

export interface DatabaseSnapshot {
  version: number;
  data: unknown;
}

export interface Change {
  type: 'insert' | 'update' | 'delete';
  timestamp: number;
  data: unknown;
}

export class GrafeoDB {
  private constructor() {
    placeholder();
  }

  static create(_options?: CreateOptions): Promise<GrafeoDB> {
    placeholder();
  }

  execute(_query: string, _options?: ExecuteOptions): Promise<Record<string, unknown>[]> {
    placeholder();
  }

  storageStats(): Promise<StorageStats> {
    placeholder();
  }

  export(): Promise<DatabaseSnapshot> {
    placeholder();
  }

  import(_snapshot: DatabaseSnapshot): Promise<void> {
    placeholder();
  }

  clear(): Promise<void> {
    placeholder();
  }

  changesSince(_timestamp: number): Promise<Change[]> {
    placeholder();
  }

  close(): Promise<void> {
    placeholder();
  }
}
