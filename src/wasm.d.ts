/**
 * Type declarations for @grafeo-db/wasm.
 *
 * These mirror the wasm-bindgen generated types from the WASM crate.
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

    /** Returns the number of nodes in the database. */
    nodeCount(): number;

    /** Returns the number of edges in the database. */
    edgeCount(): number;

    /** Returns the Grafeo version. */
    static version(): string;

    /** Frees the database from WASM memory. */
    free(): void;

    /** Export full database state as serialized bytes. */
    exportSnapshot(): Uint8Array;

    /** Import database state from serialized bytes. */
    importSnapshot(data: Uint8Array): void;
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
