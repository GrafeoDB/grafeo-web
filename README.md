# @grafeo-db/web

[Grafeo](https://github.com/GrafeoDB/grafeo) graph database in the browser.

Zero backend. Your data stays on the client.

## Features

- **Zero backend**: Grafeo runs entirely in the browser via WebAssembly
- **Persistent storage**: IndexedDB keeps your data across sessions
- **Non-blocking**: Web Worker execution keeps the UI responsive
- **Multi-language queries**: GQL, Cypher, SPARQL, Gremlin, GraphQL
- **Framework integrations**: React, Vue, Svelte
- **TypeScript-first**: Complete type definitions

## Installation

```bash
npm install @grafeo-db/web
```

> **Note**: `@grafeo-db/wasm` is not yet published to npm. For now, link it locally from the [grafeo](https://github.com/GrafeoDB/grafeo) repo.

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
console.log(GrafeoDB.version()); // e.g. "0.4.3"

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
```

Supported: `gql`, `cypher`, `sparql`, `gremlin`, `graphql`.

## API

### `GrafeoDB`

| Method | Description |
|--------|-------------|
| `GrafeoDB.create(options?)` | Create a database instance |
| `GrafeoDB.version()` | Get the WASM engine version |
| `db.execute(query, options?)` | Execute a query (GQL default, or specify language), returns `Record<string, unknown>[]` |
| `db.executeRaw(query)` | Execute a query, returns columns + rows + timing |
| `db.nodeCount()` | Number of nodes |
| `db.edgeCount()` | Number of edges |
| `db.schema()` | Schema info: labels, edge types, property keys |
| `db.export()` | Export full database as a snapshot |
| `db.import(snapshot)` | Restore from a snapshot |
| `db.clear()` | Delete all data |
| `db.storageStats()` | IndexedDB usage and quota |
| `db.changesSince(timestamp)` | Changes since timestamp (pending WASM support) |
| `db.isOpen` | Whether the database is still open |
| `db.close()` | Release WASM memory and cleanup |

### `CreateOptions`

```typescript
{
  persist?: string;          // IndexedDB key for persistence
  worker?: boolean;          // Run WASM in a Web Worker
  persistInterval?: number;  // Debounce interval in ms (default: 1000)
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

Persistence only triggers on mutating queries (INSERT, CREATE, DELETE, etc.), not on reads.

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

// Queries run in background thread — UI stays responsive
const result = await db.execute(`MATCH (a)-[*1..5]->(b) RETURN count(*)`);
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

A smaller build with GQL support only:

```typescript
import { GrafeoDB } from '@grafeo-db/web/lite';

const db = await GrafeoDB.create();
await db.execute(`MATCH (n) RETURN n`);
```

## Browser Support

| Browser | Version |
|---------|---------|
| Chrome  | 89+     |
| Firefox | 89+     |
| Safari  | 15+     |
| Edge    | 89+     |

Requires WebAssembly, IndexedDB, and Web Workers.

## Limitations

| Constraint   | Limit                          |
|--------------|--------------------------------|
| Database size | ~500 MB (IndexedDB quota)     |
| Memory       | ~256 MB (WASM heap)            |
| Concurrency  | Single writer, multiple readers |
| `changesSince()` | Returns `[]` (pending WASM change tracking) |

For larger datasets, use [Grafeo](https://github.com/GrafeoDB/grafeo) server-side.

## Development

```bash
npm run build      # Build all entries via tsup
npm test           # Run tests (vitest, 63 tests)
npm run typecheck  # Type check (tsc --noEmit)
```

## Related

| Package | Use Case |
|---------|----------|
| [`grafeo`](https://crates.io/crates/grafeo) | Rust crate |
| [`@grafeo-db/wasm`](https://github.com/GrafeoDB/grafeo) | Raw WASM binary |

## License

Apache-2.0
