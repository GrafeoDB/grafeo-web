# @grafeo-db/web

[![CI](https://github.com/GrafeoDB/grafeo-web/actions/workflows/ci.yml/badge.svg)](https://github.com/GrafeoDB/grafeo-web/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/GrafeoDB/grafeo-web/graph/badge.svg)](https://codecov.io/gh/GrafeoDB/grafeo-web)
[![npm](https://img.shields.io/npm/v/@grafeo-db/web.svg)](https://www.npmjs.com/package/@grafeo-db/web)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

[Grafeo](https://github.com/GrafeoDB/grafeo) graph database in the browser.

Zero backend. Data stays on the client.

## Features

- **Zero backend**: Grafeo runs entirely in the browser via WebAssembly
- **Persistent storage**: IndexedDB keeps data across sessions
- **Non-blocking**: Web Worker execution keeps the UI responsive
- **Multi-language queries**: GQL, Cypher, SPARQL, SQL, Gremlin, GraphQL
- **Parameterized queries**: bind `$name`-style parameters safely
- **Vector search**: HNSW indexes with k-NN and MMR search
- **Full-text search**: BM25 text indexes with hybrid (text + vector) search
- **Bulk import**: LPG nodes/edges, RDF triples, or tabular rows
- **Framework integrations**: React, Vue, Svelte
- **TypeScript-first**: Complete type definitions

## Installation

```bash
npm install @grafeo-db/web
```

## Quick Start

```typescript
import { GrafeoDB } from '@grafeo-db/web';

// In-memory database
const db = await GrafeoDB.create();

// Or persist to IndexedDB
const db = await GrafeoDB.create({ persist: 'my-database' });

// Create data
await db.execute(`INSERT (:Person {name: 'Alice', age: 30})`);
await db.execute(`INSERT (:Person {name: 'Bob', age: 25})`);
await db.execute(`
  MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'})
  INSERT (a)-[:KNOWS {since: 2020}]->(b)
`);

// Query
const result = await db.execute(`
  MATCH (p:Person)-[:KNOWS]->(friend)
  RETURN p.name, friend.name
`);

for (const row of result) {
  console.log(`${row['p.name']} knows ${row['friend.name']}`);
}

// Check version
console.log(GrafeoDB.version()); // e.g. "0.5.31"

// Cleanup
await db.close();
```

## Multi-Language Queries

```typescript
// GQL (default)
await db.execute(`MATCH (p:Person) RETURN p.name`);

// Cypher
await db.execute(`MATCH (p:Person) RETURN p.name`, { language: 'cypher' });

// SPARQL
await db.execute(`SELECT ?name WHERE { ?p a :Person ; :name ?name }`, { language: 'sparql' });

// SQL
await db.execute(`SELECT name FROM Person`, { language: 'sql' });
```

Supported: `gql`, `cypher`, `sparql`, `sql`, `gremlin`, `graphql`.

## Parameterized Queries

```typescript
const result = await db.execute(
  `MATCH (p:Person {name: $name}) RETURN p.age`,
  { params: { name: 'Alice' } },
);
```

Parameters work with all query languages and in the lite build.

## API

### `GrafeoDB`

#### Core

| Method                                                    | Description                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| `GrafeoDB.create(options?)`                               | Create a database instance                                   |
| `GrafeoDB.version()`                                      | Get the WASM engine version                                  |
| `db.execute(query, options?)`                             | Execute a query, returns `Record<string, unknown>[]`         |
| `db.executeRaw(query, options?)`                          | Execute a query, returns columns + rows + timing             |
| `db.nodeCount()`                                          | Number of nodes                                              |
| `db.edgeCount()`                                          | Number of edges                                              |
| `db.schema()`                                             | Schema info: labels, edge types, property keys               |
| `db.memoryUsage()`                                        | Hierarchical WASM heap usage breakdown                       |
| `db.setSchema(name)`                                      | Set current schema context                                   |
| `db.resetSchema()`                                        | Clear current schema context                                 |
| `db.currentSchema()`                                      | Get current schema name (or `undefined`)                     |
| `db.clearPlanCache()`                                     | Clear cached query plans                                     |
| `db.isOpen`                                               | Whether the database is still open                           |
| `db.close()`                                              | Release WASM memory and cleanup                              |

#### Persistence & Snapshots

| Method                | Description                        |
| --------------------- | ---------------------------------- |
| `db.export()`         | Export full database as a snapshot |
| `db.import(snapshot)` | Restore from a snapshot            |
| `db.clear()`          | Delete all data                    |
| `db.storageStats()`   | IndexedDB usage and quota          |

#### Import

| Method                         | Description                                       |
| ------------------------------ | ------------------------------------------------- |
| `db.importRows(rows, options)` | Import an array of objects as nodes or edges      |
| `db.importLpg(data)`           | Import LPG nodes and edges in one call            |
| `db.importRdf(data)`           | Import RDF triples (requires `rdf` WASM feature)  |

#### Vector Search (requires `vector-index` WASM feature)

| Method                                                 | Description                                  |
| ------------------------------------------------------ | -------------------------------------------- |
| `db.createVectorIndex(label, property, options?)`      | Create an HNSW vector index                  |
| `db.dropVectorIndex(label, property)`                  | Drop a vector index                          |
| `db.rebuildVectorIndex(label, property)`               | Drop and recreate, preserving config         |
| `db.vectorSearch(label, property, query, k, options?)` | k-NN search returning `[{id, distance}]`     |
| `db.mmrSearch(label, property, query, k, options?)`    | MMR search for diverse results               |

#### Text & Hybrid Search (requires `text-index` / `hybrid-search` WASM features)

| Method                                                       | Description                                |
| ------------------------------------------------------------ | ------------------------------------------ |
| `db.createTextIndex(label, property)`                        | Create a BM25 text index                   |
| `db.dropTextIndex(label, property)`                          | Drop a text index                          |
| `db.rebuildTextIndex(label, property)`                       | Rebuild a text index                       |
| `db.textSearch(label, property, query, k)`                   | Full-text search returning `[{id, score}]` |
| `db.hybridSearch(label, textProp, vectorProp, queryText, k)` | Combined BM25 + vector search              |

### `CreateOptions`

```typescript
{
  persist?: string;            // IndexedDB key for persistence
  worker?: boolean | Worker;   // Run WASM in a Web Worker (or pass a pre-created Worker)
  persistInterval?: number;    // Debounce interval in ms (default: 1000)
}
```

### `ExecuteOptions`

```typescript
{
  language?: 'gql' | 'cypher' | 'sparql' | 'sql' | 'gremlin' | 'graphql';
  params?: Record<string, unknown>;  // $name-style parameters
}
```

## Persistence

Data persists to IndexedDB automatically:

```typescript
// First visit - creates database
const db = await GrafeoDB.create({ persist: 'my-app' });
await db.execute(`INSERT (:User {name: 'Alice'})`);

// Later visit - data is still there
const db = await GrafeoDB.create({ persist: 'my-app' });
const result = await db.execute(`MATCH (u:User) RETURN u.name`);
// -> [{ 'u.name': 'Alice' }]
```

Persistence triggers after every query execution (the debounce interval prevents excessive writes).

### Storage Management

```typescript
// Check storage usage
const stats = await db.storageStats();
console.log(`Using ${stats.bytesUsed} of ${stats.quota} bytes`);

// Export database
const snapshot = await db.export();

// Import into another database
const db2 = await GrafeoDB.create();
await db2.import(snapshot);

// Clear all data
await db.clear();
```

## Web Worker Mode

For large databases or complex queries, run in a Web Worker:

```typescript
const db = await GrafeoDB.create({
  worker: true,
  persist: 'large-database',
});

// Queries run in background thread - UI stays responsive
const result = await db.execute(`MATCH (a)-[*1..5]->(b) RETURN count(*)`);
```

## Bulk Import

### LPG (nodes + edges)

```typescript
await db.importLpg({
  nodes: [
    { labels: ['Person'], properties: { name: 'Alice' } },
    { labels: ['Person'], properties: { name: 'Bob' } },
  ],
  edges: [
    { source: 0, target: 1, type: 'KNOWS', properties: { since: 2020 } },
  ],
});
```

Edge `source`/`target` are zero-based indexes into the `nodes` array from the same batch.

### Tabular rows

```typescript
// Import as nodes
await db.importRows(
  [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }],
  { mode: 'nodes', label: 'Person' },
);

// Import as edges
await db.importRows(
  [{ source: 1, target: 2, weight: 0.5 }],
  { mode: 'edges', edgeType: 'CONNECTS' },
);
```

### RDF triples (requires `rdf` WASM feature)

```typescript
await db.importRdf({
  triples: [
    { subject: 'http://ex.org/alice', predicate: 'http://ex.org/name', object: { value: 'Alice' } },
    { subject: 'http://ex.org/alice', predicate: 'http://ex.org/knows', object: 'http://ex.org/bob' },
  ],
});
```

## Framework Integrations

### React

```tsx
import { useGrafeo, useQuery } from '@grafeo-db/web/react';

function App() {
  const { db, loading, error } = useGrafeo({ persist: 'my-app' });

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return <PersonList db={db} />;
}

function PersonList({ db }) {
  const { data, loading, refetch } = useQuery(
    db,
    `MATCH (p:Person) RETURN p.name`,
  );

  if (loading) return <div>Loading...</div>;

  return (
    <ul>
      {data.map((row, i) => (
        <li key={i}>{row['p.name']}</li>
      ))}
    </ul>
  );
}
```

### Vue

```vue
<script setup>
import { useGrafeo, useQuery } from '@grafeo-db/web/vue';

const { db, loading, error } = useGrafeo({ persist: 'my-app' });
const { data } = useQuery(db, `MATCH (p:Person) RETURN p.name`);
</script>
```

### Svelte

```svelte
<script>
  import { createGrafeo } from '@grafeo-db/web/svelte';

  const { db, loading, error } = createGrafeo({ persist: 'my-app' });
</script>

{#if $loading}Loading...{/if}
{#if $error}Error: {$error.message}{/if}
```

## Lite Build

A smaller build with GQL support only (no multi-language parsers or AI search features):

```typescript
import { GrafeoDB } from '@grafeo-db/web/lite';

const db = await GrafeoDB.create();
await db.execute(`MATCH (n) RETURN n`);

// Parameterized queries work in lite too
await db.execute(`MATCH (p {name: $name}) RETURN p`, { params: { name: 'Alice' } });
```

## Browser Support

| Browser | Version |
| ------- | ------- |
| Chrome  | 89+     |
| Firefox | 89+     |
| Safari  | 15+     |
| Edge    | 89+     |

Requires WebAssembly, IndexedDB and Web Workers.

## Limitations

| Constraint       | Limit                                             |
| ---------------- | ------------------------------------------------- |
| Database size    | ~500 MB (IndexedDB quota)                         |
| Memory           | ~256 MB (WASM heap)                               |
| Concurrency      | Single writer, multiple readers                   |
| `changesSince()` | Returns `[]` (pending WASM change tracking)       |

For larger datasets, use [Grafeo](https://github.com/GrafeoDB/grafeo) server-side.

## Worker Mode vs Direct Mode

GrafeoDB supports two execution modes:

**Direct mode** (default): WASM runs on the main thread.

- Best for small databases (< 10 MB) and simple queries.
- Lowest latency: no message serialization overhead.
- Simpler setup: no bundler configuration for workers.
- Caveat: long-running queries block the UI thread.

```typescript
const db = await GrafeoDB.create();
```

**Worker mode**: WASM runs in a dedicated Web Worker.

- Best for large databases, complex traversals, or bulk imports.
- Keeps the UI responsive: all WASM execution happens off the main thread.
- Slightly higher latency per call due to message passing.
- Requires bundler support for `new Worker(...)` (Vite, Webpack 5, esbuild all support this).

```typescript
const db = await GrafeoDB.create({ worker: true });
```

If your bundler does not support auto-resolving the worker URL, pass a pre-created `Worker` instance:

```typescript
const worker = new Worker(new URL('@grafeo-db/web/worker-src', import.meta.url), { type: 'module' });
const db = await GrafeoDB.create({ worker });
```

**Rule of thumb**: start with direct mode. Switch to worker mode when queries take longer than 50 ms or when you notice UI jank.

## Troubleshooting

### Slow queries

- **Check node/edge count**: call `db.nodeCount()` and `db.edgeCount()`. Databases above ~100 K nodes may benefit from worker mode.
- **Avoid unbounded traversals**: queries like `MATCH (a)-[*]->(b)` with no depth limit scan the entire graph. Add a depth bound: `MATCH (a)-[*1..5]->(b)`.
- **Use indexes**: for vector or text search, create an index first (`db.createVectorIndex(...)` or `db.createTextIndex(...)`). Without an index, search scans all nodes.
- **Clear the plan cache**: if you have changed the shape of your data significantly, call `db.clearPlanCache()` to discard stale query plans.

### IndexedDB quota exceeded

IndexedDB quota varies by browser (typically ~500 MB, less in incognito/private mode).

- **Check usage**: call `db.storageStats()` to see current bytes used vs. quota.
- **Export and trim**: export with `db.export()`, delete unneeded nodes, then re-import.
- **Reduce persistence frequency**: set `persistInterval` to a higher value (e.g. `5000` ms) to reduce write pressure.

```typescript
const db = await GrafeoDB.create({ persist: 'mydb', persistInterval: 5000 });
```

### Worker setup in bundlers

If you see errors like "Failed to construct Worker" or "Module not found":

- **Vite**: Worker URLs via `import.meta.url` work out of the box.
- **Webpack 5**: Ensure `new Worker(new URL(...))` syntax is used. Webpack detects this pattern and bundles the worker entry.
- **Next.js**: Use the pre-created Worker approach shown above. Dynamic `import.meta.url` does not work in Next.js server components.
- **Create React App**: CRA (Webpack 4) does not support the `new URL(...)` pattern. Use `worker: new Worker(...)` with a manually configured worker URL.

## Development

```bash
npm run build      # Build all entries via tsup
npm test           # Run tests (vitest, 201 tests)
npm run typecheck  # Type check (tsc --noEmit)
```

## Related

| Package                                                  | Use Case        |
| -------------------------------------------------------- | --------------- |
| [`grafeo`](https://crates.io/crates/grafeo)              | Rust crate      |
| [`@grafeo-db/wasm`](https://github.com/GrafeoDB/grafeo)  | Raw WASM binary |

## License

Apache-2.0
