/**
 * Type declarations for @grafeo-db/wasm and @grafeo-db/wasm-lite.
 *
 * These mirror the wasm-bindgen generated types from the WASM crate (v0.5.42).
 * Both variants expose the same API surface; the lite variant simply omits
 * multi-language and AI search features at the WASM level.
 *
 * Once @grafeo-db/wasm is published to npm with its own types, this file
 * can be removed.
 */
declare module '@grafeo-db/wasm' {
  export class Database {
    /** Creates a new in-memory database. */
    constructor();

    /** Executes a GQL query and returns results as an array of objects. */
    execute(query: string): Record<string, unknown>[];

    /**
     * Executes a GQL query and returns raw columns, rows, and metadata.
     */
    executeRaw(query: string): {
      columns: string[];
      rows: unknown[][];
      executionTimeMs?: number;
    };

    /**
     * Executes a query using a specific query language.
     *
     * Supported languages: "gql", "cypher", "sparql", "gremlin", "graphql", "sql".
     */
    executeWithLanguage(
      query: string,
      language: string,
    ): Record<string, unknown>[];

    /** Executes a GQL query with named parameter substitution. */
    executeWithParams(
      query: string,
      params: object,
    ): Record<string, unknown>[];

    /** Executes a query with a specific language and named parameters. */
    executeWithLanguageAndParams(
      query: string,
      language: string,
      params: object,
    ): Record<string, unknown>[];

    /** Executes a query using a specific language and returns raw columns/rows. */
    executeRawWithLanguage(
      query: string,
      language: string,
    ): {
      columns: string[];
      rows: unknown[][];
      executionTimeMs?: number;
    };

    /** Executes a Cypher query. Requires 'cypher' WASM feature. */
    executeCypher(query: string): Record<string, unknown>[];

    /** Executes a Gremlin query. Requires 'gremlin' WASM feature. */
    executeGremlin(query: string): Record<string, unknown>[];

    /** Executes a GraphQL query. Requires 'graphql' WASM feature. */
    executeGraphql(query: string): Record<string, unknown>[];

    /** Executes a SPARQL query. Requires 'sparql' WASM feature. */
    executeSparql(query: string): Record<string, unknown>[];

    /** Executes a SQL/PGQ query. Requires 'sql-pgq' WASM feature. */
    executeSql(query: string): Record<string, unknown>[];

    /** Creates a BM25 text index on a label/property. Requires 'text-index' feature. */
    createTextIndex(label: string, property: string): void;

    /** Drops a text index. Returns true if one existed. Requires 'text-index' feature. */
    dropTextIndex(label: string, property: string): boolean;

    /** Rebuilds a text index. Requires 'text-index' feature. */
    rebuildTextIndex(label: string, property: string): void;

    /** Full-text search returning scored results. Requires 'text-index' feature. */
    textSearch(
      label: string,
      property: string,
      query: string,
      k: number,
    ): { id: number; score: number }[];

    /** Combined BM25 + vector search. Requires 'hybrid-search' feature. */
    hybridSearch(
      label: string,
      textProp: string,
      vectorProp: string,
      queryText: string,
      k: number,
    ): { id: number; score: number }[];

    /**
     * Bulk-imports LPG nodes and edges in a single call.
     * Edge source/target are zero-based indexes into the nodes array.
     */
    importLpg(data: {
      nodes: Array<{ labels: string[]; properties?: Record<string, unknown> }>;
      edges: Array<{ source: number; target: number; type: string; properties?: Record<string, unknown> }>;
    }): { nodes: number; edges: number };

    /**
     * Bulk-imports RDF triples. Requires the 'rdf' WASM feature.
     * Object can be an IRI string or { value, datatype?, language? }.
     */
    importRdf(data: {
      triples: Array<{
        subject: string;
        predicate: string;
        object: string | { value: string; datatype?: string; language?: string };
      }>;
    }): { triples: number };

    /** Creates an HNSW vector index. Requires 'vector-index' feature. Options include dimensions, metric, m, efConstruction, quantization. */
    createVectorIndex(label: string, property: string, options?: {
      dimensions?: number;
      metric?: string;
      m?: number;
      efConstruction?: number;
      quantization?: string;
    }): void;

    /** Drops a vector index. Returns true if one existed. Requires 'vector-index' feature. */
    dropVectorIndex(label: string, property: string): boolean;

    /** Rebuilds a vector index by re-scanning all matching nodes. Requires 'vector-index' feature. */
    rebuildVectorIndex(label: string, property: string): void;

    /** k-NN vector search returning {id, distance} results. Requires 'vector-index' feature. */
    vectorSearch(
      label: string,
      property: string,
      query: Float32Array,
      k: number,
      options?: object,
    ): { id: number; distance: number }[];

    /** MMR search for diverse results. Requires 'vector-index' feature. */
    mmrSearch(
      label: string,
      property: string,
      query: Float32Array,
      k: number,
      options?: object,
    ): { id: number; distance: number }[];

    /** Sets the current schema context for subsequent queries. */
    setSchema(name: string): void;

    /** Clears the current schema context. */
    resetSchema(): void;

    /** Returns the current schema name, or undefined if none is set. */
    currentSchema(): string | undefined;

    /**
     * Creates a named graph projection. Returns true if created, false if
     * a projection with that name already exists.
     */
    createProjection(
      name: string,
      nodeLabels?: string[],
      edgeTypes?: string[],
    ): boolean;

    /** Drops a named graph projection. Returns true if it existed. */
    dropProjection(name: string): boolean;

    /** Returns the names of all graph projections. */
    listProjections(): string[];

    /** Clears the query plan cache. */
    clearPlanCache(): void;

    /**
     * Rebuilds the database into a layered CompactStore (columnar base + writable overlay).
     * Non-destructive: writes after compaction land in the overlay. Requires 'compact-store' feature.
     */
    compact(): void;

    /** Returns a hierarchical memory usage breakdown. */
    memoryUsage(): object;

    /** Returns high-level database information (counts, mode, features). */
    info(): object;

    /**
     * Bulk-imports rows (array of objects) as nodes or edges.
     * The WASM equivalent of Python's import_df().
     */
    importRows(rows: object[], options: object): number;

    /** Returns the number of nodes in the database. */
    nodeCount(): number;

    /** Returns the number of edges in the database. */
    edgeCount(): number;

    /** Returns schema information about the database. */
    schema(): unknown;

    /** Returns the Grafeo version. */
    static version(): string;

    /** Export full database state as serialized bytes. */
    exportSnapshot(): Uint8Array;

    /**
     * Export as a tamper-evident snapshot: prefixed with a `GSN1` magic header
     * and appended with an HMAC-SHA256 tag. Use `importSnapshotSigned(data, key)`
     * with the same `key` to verify integrity before restoring.
     *
     * Recommended when snapshots are stored in locations the user cannot fully
     * trust (IndexedDB, server-side storage, shared URLs).
     */
    exportSnapshotSigned(key: Uint8Array): Uint8Array;

    /** Creates a database from an unsigned binary snapshot. */
    static importSnapshot(data: Uint8Array): Database;

    /**
     * Creates a database from a signed snapshot produced by
     * `exportSnapshotSigned()`. Verifies the HMAC tag in constant time; throws
     * if the data is truncated, signed with a different key, or missing the
     * `GSN1` header.
     */
    static importSnapshotSigned(data: Uint8Array, key: Uint8Array): Database;

    /**
     * Begins a new transaction. Subsequent `execute*` calls see each other's
     * uncommitted writes until `commitTransaction()` or `rollbackTransaction()`.
     * Only one transaction may be active at a time.
     */
    beginTransaction(): void;

    /** Commits the active transaction. */
    commitTransaction(): void;

    /** Rolls back the active transaction, discarding pending writes. */
    rollbackTransaction(): void;

    /** Returns `true` while a transaction is active. */
    isTransactionActive(): boolean;

    /**
     * Closes the database: rolls back any active transaction, clears the plan
     * cache, and blocks subsequent operations. Calling `close()` more than once
     * is a no-op. Because WASM data lives in memory, call `exportSnapshot()`
     * first if you need persistence.
     */
    close(): void;

    /** Frees the database from WASM memory. */
    free(): void;

    /** Explicit resource management support. */
    [Symbol.dispose](): void;
  }

  export interface InitOutput {
    readonly memory: WebAssembly.Memory;
  }

  export type InitInput =
    | RequestInfo
    | URL
    | Response
    | BufferSource
    | WebAssembly.Module;

  /** Initialize the WASM module. Must be called before creating a Database. */
  export default function init(
    module_or_path?: InitInput | Promise<InitInput>,
  ): Promise<InitOutput>;
}

/**
 * Lite variant: GQL-only, smaller binary (~507 KB gzipped).
 * Same API surface as @grafeo-db/wasm; AI search methods exist in the type
 * but throw at runtime when the feature is not compiled in.
 */
declare module '@grafeo-db/wasm-lite' {
  export class Database {
    constructor();
    execute(query: string): Record<string, unknown>[];
    executeRaw(query: string): {
      columns: string[];
      rows: unknown[][];
      executionTimeMs?: number;
    };
    executeWithParams(
      query: string,
      params: object,
    ): Record<string, unknown>[];
    nodeCount(): number;
    edgeCount(): number;
    schema(): unknown;
    setSchema(name: string): void;
    resetSchema(): void;
    currentSchema(): string | undefined;
    createProjection(
      name: string,
      nodeLabels?: string[],
      edgeTypes?: string[],
    ): boolean;
    dropProjection(name: string): boolean;
    listProjections(): string[];
    clearPlanCache(): void;
    /** Returns high-level database information (counts, mode, features). */
    info(): object;
    static version(): string;
    exportSnapshot(): Uint8Array;
    exportSnapshotSigned(key: Uint8Array): Uint8Array;
    static importSnapshot(data: Uint8Array): Database;
    static importSnapshotSigned(data: Uint8Array, key: Uint8Array): Database;
    beginTransaction(): void;
    commitTransaction(): void;
    rollbackTransaction(): void;
    isTransactionActive(): boolean;
    close(): void;
    free(): void;
    [Symbol.dispose](): void;
  }

  export interface InitOutput {
    readonly memory: WebAssembly.Memory;
  }

  export type InitInput =
    | RequestInfo
    | URL
    | Response
    | BufferSource
    | WebAssembly.Module;

  export default function init(
    module_or_path?: InitInput | Promise<InitInput>,
  ): Promise<InitOutput>;
}
