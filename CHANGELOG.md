# Changelog

All notable changes to `@grafeo-db/web`.

## [0.6.0] - 2026-10-24

Catches up on Grafeo Core 0.6.0. Databases persisted by 0.5.x load unchanged (details under Compatibility). Worker mode no longer hangs under Vite, and a new `@grafeo-db/web/worker-client` entry keeps the engine off the main thread. Some queries now return other results or fail where 0.5.44 answered: see Changed.

### Added

- **`@grafeo-db/web/worker-client`**: `GrafeoDB` with the API of the main entry, always in a Web Worker, and without importing `@grafeo-db/wasm` on the main thread. The main entry imports the engine for direct mode, and the bundler-target package fetches and compiles it (about 4 MB) as soon as it is imported, also when `create({ worker: true })` then runs everything in a worker; with the worker client only the worker loads it. Pass `{ worker }` to use a Worker your bundler builds from `@grafeo-db/web/worker-src`.
- **`executeRaw()` takes `params`**, in every language and in the lite build, through the new `executeRawWithParams` and `executeRawWithLanguageAndParams` of the engine (lists and maps included). Previously `params` was not accepted there.
- **Text index options**: `createTextIndex(label, property, { k1, b, tokenizer, stopWords })`, with the tokenizers `simple` (default), `standard` (every word, for languages such as Russian or Greek) and `cjk_bigram` (Chinese, Japanese, Korean). The database keeps the options with the index. Via Core 0.6.0.
- **Filters for text and hybrid search**: `textSearch(..., k, { filters })` and `hybridSearch(..., k, { filters })` take the property filters of `vectorSearch()` (`{ city: 'Berlin' }`, `{ rank: { $gt: 19 } }`) and search only the matching nodes, so up to `k` matching results come back. Via Core 0.6.0.
- **`QueryLanguage` gains `'graphql-rdf'`** (GraphQL over the triple store) **and `'sql-pgq'`** (an alias of `'sql'`), both accepted by the engine; TypeScript users no longer need a cast.
- **`getNodeEdges(id, { direction, edgeTypes })`**: the edges of a node as `[neighborId, edgeId]` pairs, without a query; `direction` is `'out'` (default), `'in'` or `'both'`. In every build, lite included. Via Core 0.6.0.
- **Batch writes**: `batchCreateNodesWithProps(labels, rows)` and `batchCreateEdges([{ src, dst, type, properties }])` create many nodes or edges in one transaction and return their IDs; if one breaks a constraint or names a missing node, none is created. They commit on their own, so they throw while a transaction is open. Full build only. Via Core 0.6.0.
- **Upserts**: `upsertNodes(labels, rows, { key, replace })` creates or updates nodes matched by a key property (default `id`), and `upsertEdges(edgeType, rows, { key, srcField, dstField, endpointKey, endpointLabels, replace })` does the same for edges between existing nodes; both return `{ created, updated, skipped, skippedRows }` and run in the open transaction when there is one. Full build only. Via Core 0.6.0.
- **`batchVectorSearch(label, property, queries, k, { ef, filters })`**: several query vectors in one call, one result list per query. Via Core 0.6.0.
- **`executeRaw()` reports more**: `counters` (nodes, edges, properties and labels written), `kind` (`'rows'`, `'boolean'` for SPARQL `ASK`, `'graph'` for `CONSTRUCT`) and, for a `PROFILE` statement, `profile` (the operator tree, experimental). Via Core 0.6.0.
- **`compact()` in the lite build**, and `compact()` returns the engine's `CompactReport` (`{ checkpointed, versions_collected, rows_compressed, duration_ms }`).
- **Worker errors keep their `name` and `gqlStatus`**: an error thrown in the worker reaches the main thread with its name and, when the engine sets it, its GQLSTATUS (`22012`, `22003`, `42001`, ...), not only its message.
- New types: `BatchEdge`, `CompactReport`, `NodeEdge`, `NodeEdgesOptions`, `SchemaEdgeType`, `TextIndexOptions`, `TextSearchOptions`, `UpsertEdgesOptions`, `UpsertNodesOptions`, `UpsertSummary`, `WorkerClientOptions`, `WriteCounters`.

### Changed

- **`@grafeo-db/wasm`** and **`@grafeo-db/wasm-lite`**: updated to `0.6.0`, pinned to that exact version. The Publish workflow refuses to publish a stable version on an engine pre-release.
- **`compact()` no longer builds a columnar store** (Core 0.6.0 dropped the separate compacted store): it drops the old row versions no open transaction can see, encodes the property columns in memory and returns a report. It no longer needs the `compact-store` feature.
- **Breaking: SPARQL results hold RDF terms**: each IRI, blank node and literal comes back as an RDF/JS term, `{ termType: 'NamedNode', value: 'http://ex/a' }` or `{ termType: 'Literal', value: '30', language: '', datatype: { termType: 'NamedNode', value: 'http://www.w3.org/2001/XMLSchema#integer' } }`, where it was a plain string or number. Read `.value` for the old form. GraphQL over RDF still returns plain values. Via Core 0.6.0.
- **Breaking: `importRows()` and `importLpg()` import all or nothing**: a row that breaks a constraint throws as before, but now nothing of the import is written; 0.5.44 kept the rows before the failing one. Via Core 0.6.0.
- **Breaking: a lone `INSERT` returns no rows**: `execute("INSERT (:Person {name: 'Alix'})")` returns `[]`; 0.5.44 returned the created node (`[{ _anon_0: {...} }]`). Read created data with a `RETURN`. Via Core 0.6.0.
- **Breaking: GQL sorts nulls last**, ascending and descending, unless the query says `NULLS FIRST`; `ORDER BY x DESC` put them first. Cypher keeps openCypher's order. Via Core 0.6.0.
- **Breaking: a statement nests at most 64 levels deep** (parentheses, lists, maps, function calls, `CASE`, subqueries, operator chains) and its plan at most 128; a deeper statement fails with an error that names the limit. In 0.5.44 a very large statement could overflow the stack, after which every call into the WASM module failed, `new Database()` included. Long flat statements (an `OR` of 10,000 conditions, an `INSERT` of 10,000 patterns) now run. Via Core 0.6.0.
- **Breaking: property values nest at most 128 levels deep**: a deeper list, map or path written through a parameter or a bulk import fails and writes nothing. Via Core 0.6.0.
- **Breaking: exact decimals**: in GQL and SQL/PGQ a number with a point (`1.5`) is an exact decimal, so `0.1 + 0.2 = 0.3` holds; a decimal value comes back as `{ $decimal: '1.50' }` and is written the same way. A number with an exponent (`1.5e0`) stays a float, and so does Cypher's `1.5`. SPARQL follows the XPath type promotion: `5 / 2` is `2.5`. Via Core 0.6.0.
- **Breaking: integer and decimal overflow and division by zero fail the query** with GQLSTATUS `22003` or `22012` (code `GRAFEO-Q006`), where they returned null; a float division keeps its IEEE result (`toFloat(1) / 0` is infinity). Via Core 0.6.0.
- **Error messages start with their Grafeo code** (`GRAFEO-Q001: syntax error: ...`), and a mistake in the query is reported with the code of its kind, not `GRAFEO-X001`. Via Core 0.6.0.
- **SPARQL `ASK` returns one row**, `[{ boolean: true }]` or `[{ boolean: false }]`; it returned the first matching row, or none for false. Via Core 0.6.0.
- **Worker mode processes messages one at a time, in arrival order**, also those that arrive while the engine loads.
- **The auto-created worker** is now started with a single `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })` expression, the form Vite and webpack 5 detect and bundle.
- **Development dependencies refreshed** within their major versions (Vitest 4.1.12, happy-dom 20.14, React 19.3, Vue 3.5.44, Svelte 5.57, fake-indexeddb 6.2.6), and the CI actions to `actions/checkout@v7`, `actions/setup-node@v7` and `codecov/codecov-action@v7`.

### Fixed

- **Worker mode hung on "loading" under Vite** (and any bundler that turns the engine's `.wasm` import into a top-level await): `worker.ts` imported the engine statically, so the module, and with it the message handler, finished only after the WASM was fetched and compiled, and the `init` message `create({ worker: true })` posts right away was lost. The handler is now installed synchronously, the engine is a dynamic import inside the worker, and messages wait in a queue until it is ready. A failed engine load answers each waiting call with `Failed to load the Grafeo engine: ...` and is retried by the next call.
- **Worker mode deleted a persisted snapshot it could not read**: direct mode keeps such a snapshot under `<key>__backup`, but the worker cleared it. The worker now keeps it too.
- **`SchemaInfo.edge_types` had the wrong type**: `schema()` returns `[{ name, count }]` per edge type (as it does for labels), not `string[]`. The type is now `SchemaEdgeType[]`; code that read the names as strings needs `.map((t) => t.name)`.
- **The warning for an unreadable persisted snapshot names its format and the engine**: `... "my-app" (snapshot format v4) is incompatible with this WASM version (Grafeo 0.6.0) ...`.

### Compatibility

- **Databases persisted by 0.5.x load unchanged.** The IndexedDB layout is the same, and the engine still imports the v4 snapshots that 0.5.x stored. Integration tests open a database exactly as `@grafeo-db/web` 0.5.44 stored it in IndexedDB (nodes, edges, typed properties, a property index, text and vector indexes, RDF triples) in the full build, the lite build and worker mode, and save and reopen it; the v4 snapshot exported by wasm 0.5.42 still loads too.
- **A property index from a v4 snapshot carries over without its name**: queries keep using it, but v4 never stored the name, so `SHOW INDEXES` does not list it. Create it again under a name if you need it there.
- **Grafeo 0.6.0 saves snapshot format v5**, which keeps the whole catalog (constraint and index names, text and vector index options, graph types). It reads v4 and v5. 0.5.x cannot read v5: a downgrade to `@grafeo-db/web` 0.5.x after the upgrade starts empty, keeping the database under `<key>__backup` in direct mode and deleting it in worker mode, so export it first.
- **The lite build refuses a snapshot holding data it cannot keep** (RDF triples, text or vector indexes), naming that data, where 0.5.x imported it and dropped that data silently. A database the lite build made never holds them; one imported from a full-build snapshot may. `create({ persist })` keeps such a snapshot under `<key>__backup` and starts empty; open it with the full build.

### Internal

- Integration tests for the upgrade path above, for the worker entry on the real engine (messages posted before the engine has loaded), for every 0.6 wrapper change and for the decimal, arithmetic error, SPARQL term, `ASK` and all-or-nothing import changes on the real packages, and for the built `dist/` (the worker client and the worker load no engine statically, every `exports` path exists). New v4 fixtures exported by wasm and wasm-lite 0.5.44.
- Unit tests for the worker queue (an engine whose evaluation and init are held open, and one that fails to load), the worker client (its module graph may not import either engine), and API parity of the worker client with `GrafeoDB`.
- The lockstep test accepts a pre-release engine pin of the same core version during a beta, requires both wasm packages to pin the same build and the lockfile to carry the package version; with `GRAFEO_WEB_RELEASE=1` (the Publish workflow) it refuses a stable release on a pre-release engine.
- **Publish workflow**: a pre-release version (`0.6.0-beta.1`) is published under the `next` dist-tag, as the wasm packages are, and everything else, web hotfixes included, under `latest` with an explicit tag (npm 11 requires one for a version with a pre-release part).

### Engine highlights (via Grafeo Core 0.6.0)

- **Faster queries**: filters and projections read only the property they need (about 2.5 to 3 times faster over many rows), an `IN` list uses the property index inside an `AND` chain, a label in `WHERE` scans only that label, a pattern with several labels scans the smallest, and a later `MATCH` joined by property values runs as a hash join
- **openCypher and ISO GQL semantics**: `MERGE` matches or creates the whole pattern; `OPTIONAL MATCH ... WHERE` keeps every row; a clause after a write in the same statement sees the whole write; shortest-path searches bind their path; `DIFFERENT EDGES`, `TRAIL`, `ACYCLIC` and `SIMPLE` hold for the whole path; `SHORTEST k` and `ANY k` keep k paths per pair
- **Unknown functions fail** instead of returning null (`Unknown function 'upperr'`, with a hint), as does a call with the wrong number of arguments
- **Vector search**: a query vector of another size, or with NaN, fails with `GRAFEO-V001` instead of trapping the WASM module; removing a vector no longer makes others unfindable
- **Text, hybrid and vector search return ties in node id order**, so identical calls give identical results
- **Gremlin `__.` anonymous traversals**, GQL `=~` regular expressions (the browser build uses `regex-lite`), `GROUP BY` on `RETURN` aliases, and `HAVING` right after `GROUP BY`
- **Graph algorithm results come in node id order**; k-core returns core numbers and Louvain merges communities level by level
- Not wired into `@grafeo-db/web` yet: graph handles (`db.graph(name)`) and time travel (`asOf`, `executeAsOf`, `epochAsOf` and the `historyRetention` option). The file format, WAL, checkpoint and backup changes do not apply in the browser.

## [0.5.44] - 2026-10-04

Catches up on Grafeo Core 0.5.43 + 0.5.44. No new wrapper API. The engine's correctness and consistency fixes apply transparently; the visible changes are that bulk imports now enforce the schema and that some queries which used to return wrong results now fail with an error.

### Changed

- **`@grafeo-db/wasm`** and **`@grafeo-db/wasm-lite`**: updated to 0.5.44 and **pinned to that exact version** (was `^`), so each release depends on exactly the wasm build it was tested against, matching the lockstep versioning. `@grafeo-db/web` follows Grafeo's version numbers: the next release is 0.6.0 (first announced as 0.5.45), which changes the storage format.
- **`importRows()` and `importLpg()` enforce the schema**: a row that breaks a constraint (e.g. a duplicate `UNIQUE` value) now throws, with the row named in the message (`rows[2]: ... UNIQUE constraint violation ...`). Previously it was written anyway. Rows before the failing one are kept. Via Core 0.5.44.
- **Stricter queries, as in openCypher**: these now fail with an error instead of giving wrong or null results: an unnamed expression in `WITH`; a `CALL` subquery that reads an outer variable it does not import; `UNION` mixed with `UNION ALL`; a Cypher query that ends in a `CALL` subquery returning rows; and text after a statement, including `;`-separated statements (a trailing `;` is fine). Via Core 0.5.43 and 0.5.44.
- **Unaliased columns are named after their expression**: `RETURN id(a), n.a + 1` yields the columns `id(a)` and `n.a + 1` (was `id(...)` and `expr`), and a result that would repeat a column name is an error asking for an alias. Via Core 0.5.43.

### Fixed

- **Integration tests ran against a `--target web` build only**: `tests/integration/wasm-real.test.ts` called the module's `default` init unconditionally, which the npm package (a `--target bundler` build) does not export. It now uses the same guard as `wasm-init.ts`.

### Internal

- **Integration tests run in CI** on Node 22, 24 and 25, against the real `@grafeo-db/wasm` and `@grafeo-db/wasm-lite` binaries. New: both wrappers (full and lite) on the real engine with IndexedDB persistence and reload, signed snapshots, transactions (including a failed statement inside one), the import constraint checks, and a v4 snapshot exported by wasm 0.5.42 that every release must still load.
- **Unit tests assert what they name**: every write path that saves, in the full build, the lite build and the worker, is checked to schedule exactly one save (previously several such tests asserted nothing), and `clear()` to delete the stored snapshot instead; every worker method is checked to reach the worker under its own name with its arguments; every worker handler reports `Database not initialized` after close; and import errors reach the caller in direct and worker mode. A new test keeps the wasm dependencies pinned to the release's core version.
- **Publishing uses npm trusted publishing** (OIDC, no token) and is started by the Release workflow, so a version bump merged to `main` reaches npm without a manual step.

### Compatibility

- **Persisted databases carry over**: the snapshot format is still v4. A snapshot exported by wasm 0.5.42 (nodes, edges, typed properties, a property index, RDF triples) imports into 0.5.44 unchanged.

### Engine highlights (via Grafeo Core 0.5.43)

- **GQL ran only the first statement**: `INSERT ... INSERT ...` created only the first node and `INSERT ... RETURN` ignored its `RETURN`; both now run in full
- **GQL `^` (power)**: `RETURN 2 ^ 10` returned `2`; it now computes the power
- **`ORDER BY ... LIMIT` over a whole-node `RETURN`** returned raw node IDs instead of node maps
- **`UNION` with differing branches**: SPARQL returns every variable from every branch; GQL and Cypher reject branches with different columns
- **SPARQL updates** now respect open transactions and named graphs, and `path+` returns the full transitive closure
- **`=` and `<>` on dates, times, durations and vectors** were always false / true in expressions
- **Gremlin negated text predicates**: `notRegex()`, `notContaining()`, `notStartingWith()`, `notEndingWith()`

### Engine highlights (via Grafeo Core 0.5.44)

- **Every write path checks the schema**: `SET`, `REMOVE`, `SET n:Label` and `MERGE` check property types, `NOT NULL`, `UNIQUE`, `NODE KEY` and `DEFAULT` like `INSERT`; parameterized queries are checked like the same query with literals; a missing parameter fails with `Missing parameter: $e` before anything is written
- **Constraints are stored by name**: `DROP CONSTRAINT` works, `IF NOT EXISTS` / `IF EXISTS` are supported, and `SHOW CONSTRAINTS` lists them (unnamed ones get a name such as `Person_email_unique`)
- **Transactions**: a failed statement inside a transaction is undone and the transaction goes on; a commit that fails on a write-write conflict no longer leaves the transaction active; commit and rollback cost only as much as the change
- **Nodes and edges keep their kind through every clause**: after `ORDER BY`, `DISTINCT`, `UNION`, `collect()`, grouping and the like, they no longer come back as raw IDs, as `0`, or with another entity's properties
- **`ORDER BY` uses the openCypher total order** across value types, and GQL `NULLS FIRST` / `NULLS LAST` are no longer reversed with `DESC`
- **Paths**: a variable-length edge variable is the list of the path's edges; shortest-path searches respect hop bounds and skip unreachable pairs
- **Subqueries**: `EXISTS`, `COUNT` and `VALUE` evaluate the whole pattern per row; `CALL` subqueries see the right outer variables, and the scope clause `CALL (a, b) { ... }` parses
- **`MERGE` binds every match**, one row each, instead of only the first
- **Faster lookups**: `id()` and indexed-property lookups seek directly instead of scanning, and regular expressions and `LIKE` patterns are compiled once per query
- **Dotted access into map properties** (`n.meta.route`) and Cypher pattern predicates in `WHERE` (`WHERE (d)-[:CONTAINS]->()`)
- **`REMOVE n.p` and `SET n.p = NULL` remove the property** instead of leaving it visible as null
- The WAL and checkpoint durability fixes do not apply in the browser (no filesystem)
- Not wired into the WASM binding yet: graph handles, upserts by key and write counters (planned for Grafeo 0.6.0, grafeo#441, binding parity)

## [0.5.42] - 2026-05-05

Catches up on Grafeo Core 0.5.41 + 0.5.42. Two new wrapper APIs (explicit transactions and HMAC-signed snapshots) plus a basket of transparent engine improvements: streaming top-K, IN-list index fast path, paged HNSW topology, packed RDF Ring, wasm32 simd128 distance kernels.

### Added

- **Explicit transactions on `GrafeoDB`**: `beginTransaction()`, `commitTransaction()`, `rollbackTransaction()`, `isTransactionActive()`. Subsequent `execute*` calls within a transaction see each other's uncommitted writes; `commitTransaction()` schedules persistence, `rollbackTransaction()` discards pending writes. Mirrored on the lite build and routed through the worker proxy. Surfaced from Grafeo Core 0.5.41.
- **Tamper-evident snapshots on `GrafeoDB`**: `signedExport(key)` and `signedImport(data, key)`. The export is prefixed with a `GSN1` magic header and an HMAC-SHA256 tag computed over magic + payload; `signedImport()` verifies the tag in constant time and refuses unsigned payloads, payloads signed with a different key, and truncated input. Recommended whenever snapshots travel through locations the user cannot fully trust (IndexedDB, server storage, shared URLs). Mirrored on the lite build and routed through the worker proxy. Surfaced from Grafeo Core 0.5.41.

### Changed

- **`@grafeo-db/wasm`**: updated to 0.5.42
- **`@grafeo-db/wasm-lite`**: updated to 0.5.42

### Engine highlights (via Grafeo Core 0.5.41)

- **`CALL grafeo.search.*` procedures**: text and vector search reachable as procedure calls from any query language, with scalar similarity available as a projection expression
- **wasm32 simd128 HNSW distance kernels**: 4.36x to 5.35x speedup on 384-dim f32 vectors (dot product, squared Euclidean, cosine, Manhattan). Enabled by default for wasm32 builds; runtime requires Chrome 91+, Firefox 89+, Safari 16.4+
- **RDF and CDC memory breakdown** in `memoryUsage()`: gained `rdf` (triple count, term dictionary, optional Ring index, named-graph count) and `cdc` (entity count, event count) blocks alongside the existing store/index/MVCC/cache totals (feature-gated, omitted from JSON when empty)
- **Compact-store correctness sweep**: post-`compact()` writes now visible to `MATCH`; signed Int64 columns no longer stringified after `compact()` (new `RawI64` codec); `LayeredStore` get/property/visibility methods fall through to the overlay; named graphs carry across `compact()` / `recompact()`
- **VectorScan bounded `k`**: unbounded k no longer degrades HNSW to full traversal
- **Cypher CASE WHEN aggregate substitution**: aggregates wrapped in `CASE WHEN ... THEN sum(...) ...` substitute correctly post-aggregation
- **One-way format break**: 0.5.41+ may write columns under the new `RawI64` codec discriminant; databases written by 0.5.41+ will not open in earlier 0.5.4x WASM. The existing `__backup` rescue path preserves the snapshot under a `__backup` IndexedDB key.

### Engine highlights (via Grafeo Core 0.5.42)

- **Streaming top-K operator**: bounded-heap of size k, O(k) memory regardless of input cardinality. The planner fuses literal `LIMIT k` over `Sort` into a single physical operator (~12x faster than unfused Sort+Limit at N=1M)
- **`var.prop IN [literals]` property-index fast path**: per-value index lookups unioned and deduped (~56x speedup on `WHERE id IN $ids` against a snapshot-loaded database)
- **Filter pushdown extended through `Filter`, `LeftJoin`, `Apply`, `Union`, `Unwind`**: predicates inside `OPTIONAL MATCH` and correlated subqueries now reach the scan (~8x on `feed.hydrate`-shaped queries)
- **Paged HNSW topology (vector store v2)**: `MmapTopology` serves neighbor lookups directly from `Bytes` slices; heap drops >10x under mmap, recall is bit-identical
- **Packed RDF Ring (ring v2)**: sorted term dictionary + three packed wavelet trees + two permutations + CRC32, replacing bincode
- **`MERGE ... ON CREATE/ON MATCH SET` could not reference the MERGE variable** (#317): `ON MATCH SET c.description = coalesce(c.description, 'fallback')` now binds the MERGE variable into ON CREATE / ON MATCH per ISO/IEC 39075:2024 §15.5
- **`ORDER BY` against a `WITH` alias dropped by `RETURN`** fix: e.g. `WITH x AS s ... RETURN x ORDER BY s` no longer fails with `Variable 's' not found`
- **Format upgrade on next checkpoint**: existing v1 vector-store and RDF-ring files keep loading via magic-byte detection and upgrade to v2 on the next checkpoint
- Not exposed in WASM (mmap-only, no-op in browser): per-section storage tier configuration, `db.storage_tiers()`, `db.reload_eligible()`, WAL overlay for mutable mmap'd LPG

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
