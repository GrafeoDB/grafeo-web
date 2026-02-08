/**
 * Type declarations for @grafeo-db/wasm.
 *
 * These mirror the wasm-bindgen generated types from the WASM crate (v0.4.3).
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
     * Supported languages: "gql", "cypher", "sparql", "gremlin", "graphql".
     */
    executeWithLanguage(
      query: string,
      language: string,
    ): Record<string, unknown>[];

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

    /** Creates a database from a binary snapshot. */
    static importSnapshot(data: Uint8Array): Database;

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
