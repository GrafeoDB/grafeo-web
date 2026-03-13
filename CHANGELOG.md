# Changelog

All notable changes to `@grafeo-db/web`.

## [0.5.21] - 2026-03-13

_Align with Grafeo Core 0.5.21_

### Added

- **Language-specific execute methods** in WASM type declarations: `executeCypher()`, `executeGremlin()`, `executeGraphql()`, `executeSparql()`, `executeSql()` (feature-gated convenience shortcuts)

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.21
- **`@grafeo-db/wasm-lite`**: updated to 0.5.21
- **Node.js requirement**: bumped from >=18 to >=22 (Node 18 is EOL)
- **CI matrix**: updated to Node 22, 24, 25


## [0.5.20] - 2026-03-11

_Align with Grafeo Core 0.5.20_

### Added

- **Vector index methods** (requires `vector-index` WASM feature):
  - `createVectorIndex(label, property, options?)`: create HNSW index with optional dimensions, metric, m, efConstruction
  - `dropVectorIndex(label, property)`: remove a vector index
  - `rebuildVectorIndex(label, property)`: drop and recreate, preserving config
  - `vectorSearch(label, property, query, k, options?)`: k-NN search returning `[{id, distance}]`
  - `mmrSearch(label, property, query, k, options?)`: MMR search for diverse results
- **`memoryUsage()`**: returns a hierarchical breakdown of WASM heap usage (store, indexes, MVCC, caches, string pool, buffer manager)
- **`importRows(rows, options)`**: bulk-import rows as nodes or edges, the browser equivalent of Python's `import_df()`
- **New types**: `VectorIndexOptions`, `VectorSearchOptions`, `MmrSearchOptions`, `VectorResult`, `ImportRowsOptions`, `MemoryUsage`
- Worker and proxy layers updated to route all new methods

### Engine highlights (via Grafeo Core 0.5.20)

- **WASM `memoryUsage()` and `importRows()`**: memory introspection and bulk row import now available in WebAssembly bindings
- **SESSION SET GRAPH validation**: now errors when target graph does not exist


## [0.5.19] - 2026-03-11

_Align with Grafeo Core 0.5.19_

### Added

- **`importLpg(data)`**: bulk-import LPG nodes and edges in a single call, with index-relative edge references and automatic persistence
- **`importRdf(data)`**: bulk-import RDF triples (requires `rdf` WASM feature), supporting IRI subjects/predicates and typed/language-tagged literals
- **New types**: `LpgImportData`, `LpgImportResult`, `RdfImportData`, `RdfImportResult`
- Worker and proxy layers updated to route `importLpg` and `importRdf`

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.19
- **`@grafeo-db/wasm-lite`**: updated to 0.5.19
- **WASM type declarations**: updated from v0.5.10 to v0.5.19 surface (added `importLpg`, `importRdf`)

### Engine highlights (via Grafeo Core 0.5.17-0.5.19)

- **Named graphs**: `SHOW GRAPHS`, `USE GRAPH`, `SESSION SET GRAPH`, cross-graph transactions
- **Graph type enforcement**: node type inheritance, edge endpoint validation, constraints
- **LOAD DATA**: multi-format import (CSV, JSONL, Parquet) via GQL/Cypher queries
- **RDF persistence**: SPARQL mutations now WAL-logged and snapshot-persisted
- **Cypher/GQL compliance**: 1,300+ new spec tests, correlated EXISTS, CASE WHEN fixes


## [0.5.18] - 2026-03-09

_Align with Grafeo Core 0.5.18_

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.18
- **`@grafeo-db/wasm-lite`**: updated to 0.5.18


## [0.5.17] - 2026-03-08

_Align with Grafeo Core 0.5.17_

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.17
- **`@grafeo-db/wasm-lite`**: updated to 0.5.17


## [0.5.16] - 2026-03-08

_Align with Grafeo Core 0.5.16_

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.16
- **`@grafeo-db/wasm-lite`**: updated to 0.5.16


## [0.5.13] - 2026-03-04

_Align with Grafeo Core 0.5.13_

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.13


## [0.5.12] - 2026-03-02

_Align with Grafeo Core 0.5.12_

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.12


## [0.5.11] - 2026-03-02

_Align with Grafeo Core 0.5.11_

### Changed

- **Version bump**: lockstep alignment with grafeo core 0.5.11 (engine-level improvements: atomic snapshot restore, query translator fixes, EXISTS subquery support). No WASM API surface changes.

## [0.5.10] - 2026-03-01

_Align with Grafeo Core 0.5.10_

### Added

- **Parameterized queries**: `execute(query, { params: { name: 'Alice' } })` binds `$name`-style parameters via WASM `executeWithParams` / `executeWithLanguageAndParams`
- **`executeRaw()` with language**: now accepts an optional `ExecuteOptions` parameter for language selection, dispatching to `executeRawWithLanguage`
- **`'sql'` query language**: added to `QueryLanguage` type and supported in `execute()` / `executeRaw()`
- **Text index methods** (requires WASM `text-index` feature): `createTextIndex()`, `dropTextIndex()`, `rebuildTextIndex()`, `textSearch()`
- **Hybrid search** (requires WASM `hybrid-search` feature): `hybridSearch()` combining BM25 text + vector scoring
- **`SearchResult` type**: `{ id: number; score: number }` returned by `textSearch` and `hybridSearch`
- **`LiteExecuteOptions` type**: params-only options for the lite build
- **Feature-gate errors**: descriptive messages when calling text/hybrid methods on a WASM binary built without the required feature
- **Lite params support**: `GrafeoDB.execute(query, { params })` now works in the lite build

### Changed

- **`@grafeo-db/wasm`**: dependency range covers 0.5.x (was `^0.5.0`)
- **WASM type declarations**: updated from v0.5.0 to v0.5.10 surface (13 new methods)
- Worker and proxy layers updated to route all new methods

## [0.5.1] - 2026-02-12

_Version Alignment with Grafeo Core_

### Changed

- **Lockstep versioning**: `@grafeo-db/web` now follows the same version number as the core `grafeo` engine, making compatibility obvious - web 0.5.1 = grafeo 0.5.1

## [0.5.0] - 2026-02-11

_Upgrade to Grafeo WASM 0.5.0_

### Changed

- **`@grafeo-db/wasm` 0.5.0**: upgraded dependency from `^0.4.3` to `^0.5.0`
- **Peer dependency minimums**: React >=19 (was >=18), Svelte >=5 (was >=3)
- **Vitest mock alias**: WASM mock now resolved via `resolve.alias` in vitest config instead of manual imports

## [0.2.1] - 2026-02-15

_Release Prep - Framework Parity, CI, Demo_

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

_Upgrade to Grafeo WASM 0.4.3 - Full API Support_

### Added

- **Multi-language query support**: `execute(query, { language: 'cypher' })` now routes to `executeWithLanguage()` in the WASM engine. Supported: `gql`, `cypher`, `sparql`, `gremlin`, `graphql`
- **`db.schema()`**: returns schema information (labels, edge types, property keys) from the WASM engine
- **Real snapshot persistence**: `exportSnapshot()` and `importSnapshot()` are now backed by the Rust implementation (previously were stubs)

### Changed

- **WASM 0.4.3**: upgraded from 0.4.2 - includes `executeWithLanguage`, `exportSnapshot`/`importSnapshot`, and `schema`
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
