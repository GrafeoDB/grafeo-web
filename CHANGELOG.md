# Changelog

All notable changes to `@grafeo-db/web`.

## [0.5.40-hotfix.1] - 2026-04-20

### Fixed

- **WASM init compatibility with `--target bundler` builds**: `wasm-init.ts`, `wasm-init-lite.ts`, and `worker.ts` unconditionally called the `default` export of `@grafeo-db/wasm` / `@grafeo-db/wasm-lite`. When the underlying package is built with `wasm-pack --target bundler`, the module auto-initializes on import and exposes no `default` export, so the call threw at `create()`. The initializers now use a namespace import and only invoke `default()` when it exists; otherwise they resolve immediately. Users on wasm packages built with `--target web` (which ship a `__wbg_init` default export) are unaffected.

### Added

- **Integration test: advertised query languages are compiled in**: `tests/integration/wasm-real.test.ts` now probes every language exposed through `executeWithLanguage()` (`gql`, `cypher`, `sparql`, `gremlin`, `graphql`, `sql`) and asserts the dispatcher does not return "Unknown query language". This guards against the wasm package being accidentally built with a narrow feature set (e.g. `--features ai`) instead of `--features full`.

## [0.5.40] - 2026-04-20

Upstream 0.5.39 + 0.5.40 features. No new WASM API surface; version bump, documentation corrections, and behavioral notes.

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.40
- **`@grafeo-db/wasm-lite`**: updated to 0.5.40
- **`compact()` is now non-destructive**: the underlying Grafeo Core `compact()` builds a writable layered store (columnar base + in-memory overlay) instead of switching to read-only mode. Writes after `compact()` land in the overlay; reads merge both layers. Documentation and type-declaration comments updated to reflect this.
- **`memoryUsage()` totals**: Grafeo Core 0.5.40 broadened `memory_bytes` accounting to cover the full heap (store + indexes + MVCC + caches + string pools + buffer manager), so reported values will be larger than before at the same workload. No schema change, no API change.

### Engine highlights (via Grafeo Core 0.5.39-0.5.40)

- **Unified hybrid queries**: `text_score()` and `text_match()` usable as filter expressions in GQL/Cypher, with planner pushdown to `TextScan`/`VectorScan`, compound AND/OR joins, top-K recognition, and score projection
- **BM25 text scan operator**: top-K and threshold modes via `InvertedIndex.score_document`, `search_with_threshold`, `bm25_term_score`
- **Native Float64 / Float32Vector codecs**: CompactStore stores them directly instead of falling back to dictionary encoding; mixed `Int64+Float64` columns coalesce to Float64
- **MERGE index lookup**: `MERGE (n:Label {prop: value})` now uses property indexes when available, eliminating O(n) scan on large graphs
- **Multi-schema transaction atomicity**: `SESSION SET SCHEMA` mid-transaction no longer loses pre-switch writes on COMMIT
- **Commit failure auto-rollback**: a failed COMMIT now discards pending writes and returns the session to a clean state
- **Schema and graph names reject `/`**: `CREATE SCHEMA` / `CREATE GRAPH` now fail on names containing `/`, surfaced through `setSchema()` as a WASM error
- **Vector strict pushdown boundary**: `euclidean_distance(...) < t` and `manhattan_distance(...) < t` now correctly exclude rows at exactly the threshold
- **Compact-store correctness**: ~26 vector/text index methods no longer panic after `compact()`; `LayeredStore` sees nodes added after compaction; named graphs carry across `compact()` / `recompact()`; `nodes_by_label` drops redundant lock acquisition per chunk
- **Parser keyword anti-pattern fixes**: four `CREATE CONSTRAINT ... FOR` / `ON REPLACE` sites where identifier-fallback tokenization accepted the wrong keyword
- **Block-STM conflict partitioning** (0.5.39): groups conflicting transactions into disjoint clusters for parallel re-execution
- **Push-based pipeline execution** (0.5.39): filter, sort, aggregate, limit, and distinct queries now flow through a push pipeline, reducing per-row overhead
- **Parser overflow hardening** (0.5.39): integer overflow in Cypher, SQL/PGQ, Gremlin, GraphQL now returns errors instead of silently producing `0`; float overflow (`1e999`) in GraphQL rejected
- **Resource limits** (0.5.39): Grafeo Core now defaults to 30-second query timeout, 16 MiB property value size limit, HNSW `max_elements` bound
- **Parameters in subqueries** (0.5.39): `$param` inside `EXISTS` / `COUNT` / `VALUE` subqueries now substituted correctly
- **SSI validation race, deadlock ordering, DPccp `BitSet` overflow, DISTINCT hash collisions** (0.5.39): a sweep of transaction/planner fixes
- **Leaner WASM builds** (0.5.39): removed `grafeo-storage`, `crc32fast`, `anyhow` from WASM targets; binary size now ~650 KB gzipped
- Not yet in WASM: streaming results (`executeStream()` is Node.js-only), `metrics()` / `metricsPrometheus()` (Python/Node.js), encryption at rest, `GrafeoError` structured errors


## [0.5.38] - 2026-04-13

Hardening release, plus upstream 0.5.38 features.

**Breaking:** `changesSince()` now throws an error instead of silently returning an empty array. Code that called `changesSince()` and handled the empty result will need a try/catch or should remove the call until the WASM engine exposes change tracking. `executeRaw()` signature narrowed from `ExecuteOptions` to `Pick<ExecuteOptions, 'language'>`: code that passed `params` to `executeRaw()` will get a TypeScript error (params were silently ignored before, so removing them is the correct fix).

### Added

- **`SchemaInfo` type**: `schema()` now returns a typed `SchemaInfo` instead of `unknown`, with `lpg.labels`, `lpg.edgeTypes`, and `lpg.propertyKeys` fields
- **`onPersistError` callback**: `CreateOptions` accepts an optional error handler for IndexedDB persistence failures (defaults to `console.error`)
- **Generic `execute<T>()`**: both full and lite builds support `execute<T>()` for type-safe query results
- **`LiteCreateOptions` type**: lite build now uses its own options type without the `worker` field
- **Quantized vector indexes**: `VectorIndexOptions.quantization` accepts `"scalar"`, `"binary"`, or `"product"` for up to 4x memory reduction (upstream 0.5.38)
- **Vue reactive query string**: `useQuery()` now accepts `Ref<string>` in addition to plain `string`, re-executing when the ref changes

### Fixed

- **`import()` use-after-free**: `importSnapshot()` is now called before `free()` so a failed import leaves the database usable instead of in a corrupted state (index.ts, lite.ts, worker.ts)
- **Persistence timer race**: `PersistenceManager` now tracks a `disposed` flag, preventing debounced save callbacks from firing after `close()`/`flush()`
- **WorkerProxy double-init**: calling `init()` twice now terminates the old Worker and rejects its pending promises instead of orphaning it
- **Worker double-init**: a second `init` message now frees the old WASM instance and flushes persistence instead of leaking memory
- **Vue `useGrafeo` unmount race**: if the component unmounts before `GrafeoDB.create()` resolves, the created instance is now closed instead of leaked
- **Svelte `createQuery` double-unsubscribe**: a guard flag prevents `unsubscribeDb()` from being called multiple times when stores unsubscribe concurrently
- **Snapshot migration backup**: when a persisted snapshot is incompatible with the current WASM version, it is now saved under a `__backup` key before clearing, preventing silent data loss

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.38
- **`@grafeo-db/wasm-lite`**: updated to 0.5.38
- **`changesSince()` throws**: now throws `"not yet implemented"` instead of silently returning `[]`
- **`executeRaw()` type narrowed**: signature changed from `ExecuteOptions` to `Pick<ExecuteOptions, 'language'>` to clarify that `params` is not supported for raw queries

### Engine highlights (via Grafeo Core 0.5.38)

- **Quantized vector indexes**: `"scalar"`, `"binary"`, `"product"` quantization for up to 4x memory savings
- **EXPLAIN for all 6 query languages**: Gremlin, GraphQL, and SQL/PGQ now support `EXPLAIN`/`EXPLAIN ANALYZE` (not yet exposed in WASM bindings)
- **Unicode identifiers**: GQL, Cypher, and SQL/PGQ parsers accept Unicode letters per ISO GQL 39075
- **Parser recursion depth limits**: 128-level nesting cap prevents stack overflow on malicious input
- **Weighted hybrid search fix**: vector distances are now negated before fusion so closer vectors rank higher
- **Edge variables in multi-hop queries**: edge columns now resolve to full maps instead of raw IDs
- **GQL `!=` operator**: accepted as alias for `<>`


## [0.5.37] - 2026-04-12

_Align with Grafeo Core 0.5.37_

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.37
- **`@grafeo-db/wasm-lite`**: updated to 0.5.37


## [0.5.36] - 2026-04-11

_Align with Grafeo Core 0.5.36_

### Added

- **Graph projection methods**: read-only filtered views of the graph, powered by the new Grafeo Core projection engine
  - `createProjection(name, nodeLabels?, edgeTypes?)`: create a named projection scoped by label and edge-type filters. Returns `true` if created, `false` if a projection with that name already exists
  - `dropProjection(name)`: remove a projection. Returns `true` if it existed
  - `listProjections()`: list the names of all active projections
- Worker and proxy layers updated to route all projection methods
- 21 new tests covering projections (direct, worker proxy, lite, persistence, closed-db guards)

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.36
- **`@grafeo-db/wasm-lite`**: updated to 0.5.36
- **WASM type declarations**: version comment updated to v0.5.36, added 3 projection methods to both full and lite module declarations

### Engine highlights (via Grafeo Core 0.5.36)

- **Role-based access control**: `Identity`, `Role` (`Admin`/`ReadWrite`/`ReadOnly`), and per-graph `Grant` types for session-level permission scoping. Not yet exposed in WASM bindings
- **Graph projections**: `ProjectionSpec` filters by node labels and edge types, available across Rust, Python, Node.js, WASM, and C
- **Gremlin `repeat().times()`/`.emit()`**: fixed-depth and all-depths traversal via `VariableLengthExpand`
- **CSV/JSON Lines import**: CLI and binding-level bulk import (not applicable to WASM)
- **Unified aggregate accumulator**: push-based operator now supports all 30+ aggregate functions
- **`session_read_only()` deprecated**: use `session_with_role(Role::ReadOnly)` instead
- **Bug fixes**: parameterized query permission bypass, projection neighbor/edge-type leakage, spill serialization DISTINCT semantics, Gremlin negative `times()`, stale projections after `compact()`


## [0.5.35] - 2026-04-11

_Align with Grafeo Core 0.5.35_

### Breaking

- **Storage format changed**: Grafeo Core 0.5.35 switched from bincode blobs to a block-based section format. Databases persisted to IndexedDB with 0.5.34 or earlier are **incompatible**. Export your data (`db.export()`) before upgrading, then re-import (`db.import(snapshot)`) after. If an incompatible snapshot is detected, `create()` now logs a warning and starts a fresh database instead of crashing.
- **Feature profile rename**: the `rdf` WASM feature flag has been renamed to `triple-store`. The old `rdf` alias still works in this release but is deprecated and will be removed in 0.7.0. Persona-based profiles (`lpg`, `rdf`, `analytics`, `ai`, `edge`, `enterprise`) replace the old deployment-target profiles (`embedded`, `browser`, `server`, `full`).

### Added

- **`compact()`**: converts the database to CompactStore format for read-optimized, memory-constrained use. Requires `compact-store` WASM feature. Available in direct, worker, and proxy modes.
- **Snapshot migration guard**: `GrafeoDB.create({ persist: '...' })` now catches incompatible snapshots from older WASM versions, clears the stale IndexedDB entry, and starts fresh with a console warning.

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.35
- **`@grafeo-db/wasm-lite`**: updated to 0.5.35
- **WASM type declarations**: version comment updated to v0.5.35, added `compact()` method

### Engine highlights (via Grafeo Core 0.5.35)

- **Block-based container format**: `.grafeo` files use section directories with checksummed, independently addressable sections. Checkpoint writes only dirty sections, recovery loads in parallel
- **`grafeo-storage` crate**: persistence I/O extracted from `grafeo-adapters` into its own crate
- **Arrow IPC export** (`arrow-export`): zero-copy export to Arrow IPC for DuckDB, Polars, pandas interop
- **GEXF + GraphML export**: graph interchange for Gephi, Cytoscape, NetworkX
- **Incremental backup**: `backup_full()`, `backup_incremental()`, `restore_to_epoch()` in the core engine
- **CDC retention and eviction**: epoch-based and count-based retention limits for the change data capture log
- **WAL overlay**: in-memory mutation layer for mmap'd base data
- **Vector spill to disk**: vector columns drain to mmap storage under memory pressure
- **Per-section memory config**: `SectionMemoryConfig` with `max_ram` caps per section type
- **`QueryResult.rows` is now private** in the Rust API (use `rows()`/`into_rows()`), no impact on WASM/JS surface
- **`#[non_exhaustive]` on 95 public enums** in the Rust API, no impact on WASM/JS surface
- **WAL replay fix**: data written via mutations was previously lost across restarts when no explicit checkpoint was called


## [0.5.34] - 2026-04-07

_Align with Grafeo Core 0.5.34_

Test coverage, dependency updates and documentation fixes.

### Added

- **Error handling tests**: concurrent `createGrafeo()` race (10 parallel calls), use-after-close for 8 methods, feature detection for 6 missing WASM features
- **API parity tests**: worker proxy vs main API method coverage, schema reflection after mutations, lite build export verification
- **React lifecycle test**: mount/unmount/remount with no stale state
- **Vue reactive test**: query ref change triggers result update, null db reset, db swap re-execution
- **Svelte lifecycle test**: unsubscribe closes db, resubscribe behavior, independent instances

### Fixed

- README: persistence description corrected (fires after every query, not only mutations)
- README: `CreateOptions.worker` type corrected to `boolean | Worker`
- README: version example updated from 0.5.27 to 0.5.31
- `.claude/CLAUDE.md`: stale persistence lesson corrected

### Changed

- TypeScript bumped from ^5.3.0 to ^5.8.0
- vitest bumped from ^4.0.18 to ^4.1.2
- happy-dom bumped from ^20.6.1 to ^20.8.9
- `@grafeo-db/wasm` and `@grafeo-db/wasm-lite` bumped from ^0.5.31 to ^0.5.33
- README: added Worker vs Direct mode guide with bundler examples (Vite, Webpack, Next.js)
- README: added Troubleshooting section (slow queries, IndexedDB quota, worker setup)
- 201 tests passing

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.34
- **`@grafeo-db/wasm-lite`**: updated to 0.5.34


## [0.5.33] - 2026-04-05

_Align with Grafeo Core 0.5.33_

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.33
- **`@grafeo-db/wasm-lite`**: updated to 0.5.33


## [0.5.32] - 2026-04-03

_Align with Grafeo Core 0.5.32_

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.32
- **`@grafeo-db/wasm-lite`**: updated to 0.5.32


## [0.5.31] - 2026-04-01

_Align with Grafeo Core 0.5.31_

### Added

- **`info()`**: returns high-level database information (mode, counts, persistence status, version, compiled feature flags). Available in full, lite, and worker builds
- **`DatabaseInfo` type**: typed interface for the `info()` return value

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.31
- **`@grafeo-db/wasm-lite`**: updated to 0.5.31
- **WASM type declarations**: version comment updated to v0.5.31, added `info()` method

### Engine highlights (via Grafeo Core 0.5.31)

- **CompactStore**: read-optimized columnar graph store for memory-constrained environments (WASM, edge workers, embedded). Per-label columnar storage with typed columns, double-indexed CSR adjacency, zone-map skip optimization. Opt-in via `compact-store` feature flag
- **SQL/PGQ UNION, INTERSECT, EXCEPT**: full set operation support between GRAPH_TABLE queries
- **GraphQL multiple root fields and variable substitution**: all root fields now translated via Union; `$variable` references emit parameters with default value propagation
- **GQL list slice and path search fixes**: `[1..3]`, `[..2]`, `[3..]` slices, `MATCH ANY p = ...` and `MATCH p = ANY SHORTEST ...` path search
- **SPARQL fixes**: MINUS, property paths, VALUES with UNDEF, `GRAPH ?g` scoping, `DESCRIBE`, string/type functions in projections, DELETE with FILTER
- **Gremlin traversal fixes**: multi-hop dead ends, `values()` all-properties, scalar union coercion, `path()` on empty traversal
- **Cypher `CREATE INDEX` / `DROP INDEX` / `SHOW INDEXES`**: indexes now registered in catalog
- **GraphQL aggregation**: `personCount`, `personAggregate`, and `_count` field patterns
- **RDF schema type propagation**: concrete types threaded through plan tree, ~5x memory reduction for triple scan columns


## [0.5.30] - 2026-03-30

_Align with Grafeo Core 0.5.28-0.5.30_

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.30
- **`@grafeo-db/wasm-lite`**: updated to 0.5.30
- **WASM type declarations**: version comment updated to v0.5.30 (no API surface changes)

### Engine highlights (via Grafeo Core 0.5.28-0.5.30)

- **`.grafeo` single-file format fix** (0.5.28): the `grafeo-file` feature was missing from the embedded profile, causing silent fallback to WAL directory format. Now works correctly for snapshot import/export
- **Integer arithmetic safety** (0.5.29): overflow (e.g. `9223372036854775807 + 1`) returns NULL instead of panicking. Checked arithmetic for all operations
- **Label intersection** (0.5.29): `MATCH (n:A) MATCH (n:B)` now correctly filters to nodes with both labels
- **EXISTS with property filters** (0.5.29): `EXISTS { (n)-[:R]->(m) WHERE m.age > 30 }` now includes the WHERE clause
- **EXISTS subquery in RETURN** (0.5.29): `RETURN EXISTS { MATCH (n)-[:R]->(:Label) } AS flag`
- **Keywords as property names** (0.5.29): `{order: 3}` and `n.order` now parse correctly
- **CASE WHEN with NULL aggregates** (0.5.29): correct handling when aggregate returns NULL
- **Aggregate detection in GQL WITH** (0.5.29): `WITH count(n) AS cnt, max(n.val) AS mx` produces correct aggregate operators
- **Gremlin fixes** (0.5.29): `hasLabel()` on edges, `coalesce()` first-non-empty semantics, `group().by()` two-pass fix, `optional()` per-row semantics, `values()` null filtering, `or()` three-valued logic
- **SPARQL functions in SELECT** (0.5.29): STRLEN, UCASE, LCASE, IF, COALESCE, REPLACE and more now work in projections. IN/NOT IN operators added. BOUND() distinguishes unbound from null
- **SQL/PGQ fixes** (0.5.29-0.5.30): unbounded variable-length paths, COUNT(column) NULL skipping, CASE in WHERE, zero-length paths, ORDER BY aggregate aliases, parameters in WHERE, HAVING inline aggregates
- **Cypher `collect(DISTINCT ...)`** (0.5.30): `size(collect(DISTINCT n.v))` correctly extracts wrapped aggregate
- **Memory optimization** (0.5.29): adjacency list struct reduced from 256 to ~144 bytes with auto-compaction
- **JSON Infinity/NaN** (0.5.29): `SUM()` overflow encoded as string `"Infinity"` instead of `null`


## [0.5.27] - 2026-03-27

_Align with Grafeo Core 0.5.27_

### Added

- **Schema context methods**: `setSchema(name)`, `resetSchema()`, `currentSchema()` for multi-schema workflows. Persists across `execute()` calls
- **`clearPlanCache()`**: clears cached query plans, useful after schema or index changes
- Worker and proxy layers updated to route all new methods

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.27
- **`@grafeo-db/wasm-lite`**: updated to 0.5.27
- **WASM type declarations**: updated from v0.5.21 to v0.5.27 surface (4 new methods)

### Engine highlights (via Grafeo Core 0.5.25-0.5.27)

- **`labels(n)`/`type(r)` in aggregation** (#187): complex expressions in GROUP BY and ORDER BY no longer fail with "Cannot resolve expression to column"
- **ORDER BY complex expressions**: `ORDER BY labels(n)[0]` no longer leaks synthetic `__expr_` columns into results
- **GROUP BY on list-valued keys**: `GROUP BY labels(n)` on multi-label nodes no longer produces extra rows
- **SPARQL GROUP BY/ORDER BY with expressions**: `GROUP BY (STR(?s))` no longer fails with "Store required for expression evaluation"
- **Vector search filter optimization**: operator filters ($gt, $lt, etc.) now scan only the narrowed allowlist instead of all nodes
- **Adjacency inline capacity**: raised SmallVec from 4 to 8, fewer heap allocations for typical node degrees


## [0.5.26] - 2026-03-26

_Align with Grafeo Core 0.5.26_

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.26
- **`@grafeo-db/wasm-lite`**: updated to 0.5.26


## [0.5.25] - 2026-03-25

_Align with Grafeo Core 0.5.25_

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.25
- **`@grafeo-db/wasm-lite`**: updated to 0.5.25


## [0.5.24] - 2026-03-24

_Align with Grafeo Core 0.5.24_

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.24
- **`@grafeo-db/wasm-lite`**: updated to 0.5.24


## [0.5.23] - 2026-03-23

_Align with Grafeo Core 0.5.23_

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.23
- **`@grafeo-db/wasm-lite`**: updated to 0.5.23


## [0.5.22] - 2026-03-14

_Align with Grafeo Core 0.5.22_

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.22
- **`@grafeo-db/wasm-lite`**: updated to 0.5.22


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
