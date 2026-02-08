# Changelog

All notable changes to `@grafeo-db/web`.

## [0.1.1] - 2026-02-08

_First Working Implementation - Browser Graph Database via WebAssembly_

### Added

- **Core `GrafeoDB` class** (`src/index.ts`): async factory `create()`, `execute()` with query language option, `executeRaw()` for column/row metadata, `nodeCount()`, `edgeCount()`, `export()`/`import()` for snapshot serialization, `clear()`, `close()` with WASM memory cleanup
- **Lite build** (`src/lite.ts`): GQL-only variant targeting ~400 KB gzipped bundle, same API without language selection
- **IndexedDB persistence** (`src/persistence.ts`): debounced snapshot writes, restore-on-load via `create({ persist: 'key' })`, `storageStats()` using Storage API estimates, per-database isolation
- **Web Worker support** (`src/worker.ts`, `src/worker-proxy.ts`): off-main-thread WASM execution via `create({ worker: true })`, request/response message protocol with Promise-based proxy, identical API to direct mode
- **React hooks** (`src/react.ts`): `useGrafeo()` for database lifecycle with cleanup on unmount, `useQuery()` for reactive queries with refetch support
- **Vue composables** (`src/vue.ts`): `useGrafeo()` and `useQuery()` with `Ref<T>` reactivity and `onUnmounted` cleanup
- **Svelte stores** (`src/svelte.ts`): `createGrafeo()` returning `Readable<T>` stores with auto-cleanup on last unsubscribe
- **Shared type definitions** (`src/types.ts`): `QueryLanguage`, `CreateOptions`, `ExecuteOptions`, `StorageStats`, `DatabaseSnapshot`, `Change`, `RawQueryResult`, `WorkerRequest`/`WorkerResponse`
- **WASM type declarations** (`src/wasm.d.ts`): TypeScript module declaration for `@grafeo-db/wasm` covering `Database` class and `init()` function
- **Test suite**: 23 tests covering GrafeoDB lifecycle, CRUD operations, export/import, persistence manager with debouncing, and IndexedDB isolation
- **Build system**: tsup with 6 entry points (index, lite, react, vue, svelte, worker), ESM + CJS dual format, TypeScript declarations, source maps
- **CI**: vitest with happy-dom environment and fake-indexeddb polyfill

### Notes

- `@grafeo-db/wasm` is linked locally (not yet published to npm)
- `exportSnapshot()`/`importSnapshot()` declared in types but pending Rust implementation in the WASM crate
- `changesSince()` returns empty array pending WASM engine change tracking API
- `import.meta.url` warning in CJS build is expected (Worker is ESM-first)
