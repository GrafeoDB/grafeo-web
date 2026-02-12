# Changelog

All notable changes to `@grafeo-db/web`.

## [0.2.1] - 2026-02-11

_Release Prep — Framework Parity, CI, Demo_

### Added

- **Svelte `createQuery`** (`src/svelte.ts`): new store factory for reactive queries with `{ data, loading, error, refetch }`, matching the React/Vue API
- **`ExecuteOptions` in Vue/Svelte**: `useQuery()` and `createQuery()` now accept `{ language }` option, aligning all three frameworks
- **CI test step**: `npm test` now runs in the GitHub Actions pipeline across Node.js 18/20/22
- **Interactive demo** (`demo/index.html`): standalone Grafeo Playground with query editor, sample data, and table results

### Changed

- **`@grafeo-db/wasm` from npm**: dependency now points to `^0.4.3` on the npm registry (was a local `file:` link)
- **vitest 4.x compatibility**: updated worker-proxy test mocks to use `function` syntax for constructor mocks
- Test count: 68 total (up from 63)

### Removed

- README note about `@grafeo-db/wasm` not being published (it is now)

## [0.2.0] - 2026-02-08

_Upgrade to Grafeo WASM 0.4.3 — Full API Support_

### Added

- **Multi-language query support**: `execute(query, { language: 'cypher' })` now routes to `executeWithLanguage()` in the WASM engine. Supported: `gql`, `cypher`, `sparql`, `gremlin`, `graphql`
- **`db.schema()`**: returns schema information (labels, edge types, property keys) from the WASM engine
- **Real snapshot persistence**: `exportSnapshot()` and `importSnapshot()` are now backed by the Rust implementation (previously were stubs)

### Changed

- **WASM 0.4.3**: upgraded from 0.4.2 — includes `executeWithLanguage`, `exportSnapshot`/`importSnapshot`, and `schema`
- **`importSnapshot` is now static**: creates a new `Database` instance from snapshot bytes (was an instance method). This changes the internal persistence restore and `import()` flows
- Mock updated to match 0.4.3 API surface (`executeWithLanguage`, `schema`, static `importSnapshot`)

## [0.1.3] - 2026-02-08

_Test Coverage & Code Cleanup_

### Added

- **Svelte store tests** (`src/svelte.test.ts`): 6 tests covering store lifecycle, subscriber notifications, auto-close, manual close, and error handling
- **Vue composable tests** (`src/vue.test.ts`): 7 tests covering `useGrafeo()` lifecycle, unmount cleanup, error handling, `useQuery()` execution, and refetch
- **React hook tests** (`src/react.test.ts`): 6 tests covering `useGrafeo()` lifecycle, unmount cleanup, error handling, `useQuery()` execution
- **Worker proxy tests** (`src/worker-proxy.test.ts`): 9 tests covering init, execute, executeRaw, nodeCount/edgeCount, close, error responses, and worker crash handling

### Changed

- Extracted `isMutatingQuery()` to shared `src/query-utils.ts` (was duplicated in index.ts, lite.ts, worker.ts)
- Test count: 63 total (up from 35)

## [0.1.2] - 2026-02-08

_Bug Fixes & Robustness_

### Fixed

- **WASM init race condition**: concurrent `create()` calls no longer double-initialize the WASM module; uses a promise singleton pattern via shared `src/wasm-init.ts`
- **Duplicate WASM init**: `index.ts` and `lite.ts` now share a single initialization, preventing double-loading when both modules are imported
- **Unnecessary persistence writes**: `execute()` and `executeRaw()` no longer trigger IndexedDB saves for read-only queries (MATCH); only mutating queries (INSERT, CREATE, DELETE, etc) schedule persistence
- **Silent persistence failures**: `scheduleSave()` now catches errors in the debounced callback and reports them via a configurable `onError` handler (defaults to `console.error`)

### Added

- `GrafeoDB.version()` static method exposing the WASM engine version
- `db.isOpen` getter for checking database state without try/catch
- Test suite for the lite build (`src/lite.test.ts`)

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
