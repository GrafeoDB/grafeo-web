# PLACEHOLDER README, NOT YET IMPLEMENTED

[Grafeo](https://github.com/GrafeoDB/grafeo) graph database in the browser.

Zero backend. Your data stays on the client.

## Features

- **Zero backend**: Grafeo runs entirely in the browser via WebAssembly
- **Persistent storage**: IndexedDB keeps your data across sessions
- **Non-blocking**: Web Worker execution keeps the UI responsive
- **Full query support**: GQL, Cypher, SPARQL, GraphQL, Gremlin
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
const db = await GrafeoDB.create({ 
  persist: 'my-database' 
});

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
// → [{ 'u.name': 'Alice' }]
```

### Storage Management

```typescript
// Check storage usage
const stats = await db.storageStats();
console.log(`Using ${stats.bytesUsed} of ${stats.quota} bytes`);

// Export database
const snapshot = await db.export();
localStorage.setItem('backup', JSON.stringify(snapshot));

// Import database
const backup = JSON.parse(localStorage.getItem('backup'));
await db.import(backup);

// Clear all data
await db.clear();
```

## Web Worker Mode

For large databases or complex queries, run in a Web Worker:

```typescript
import { GrafeoDB } from '@grafeo-db/web';

const db = await GrafeoDB.create({
  worker: true,
  persist: 'large-database'
});

// Queries run in background thread
// UI stays responsive
const result = await db.execute(`
  MATCH (a)-[*1..5]->(b) 
  RETURN count(*)
`);
```

## Framework Integrations

### React

```typescript
import { useGrafeo, useQuery } from '@grafeo-db/web/react';

function App() {
  const { db, loading, error } = useGrafeo({ persist: 'my-app' });
  
  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  
  return <PersonList db={db} />;
}

function PersonList({ db }) {
  const { data, loading } = useQuery(db, `MATCH (p:Person) RETURN p`);
  
  if (loading) return <div>Loading...</div>;
  
  return (
    <ul>
      {data.map(row => <li key={row.p.id}>{row.p.name}</li>)}
    </ul>
  );
}
```

### Vue

```typescript
import { useGrafeo, useQuery } from '@grafeo-db/web/vue';

const { db, loading, error } = useGrafeo({ persist: 'my-app' });

const { data } = useQuery(db, `MATCH (p:Person) RETURN p`);
```

### Svelte

```typescript
import { createGrafeo } from '@grafeo-db/web/svelte';

const { db, loading, error } = createGrafeo({ persist: 'my-app' });
```

## Offline-First

Grafeo works completely offline:

```typescript
const db = await GrafeoDB.create({ persist: 'offline-app' });

// Works with or without network
await db.execute(`INSERT (:Note {text: 'Remember milk'})`);

// Optional: sync with your backend when online
if (navigator.onLine) {
  const changes = await db.changesSince(lastSync);
  await fetch('/api/sync', { 
    method: 'POST', 
    body: JSON.stringify(changes) 
  });
}
```

## Query Languages

```typescript
// GQL (default)
await db.execute(`INSERT (:Person {name: 'Alice'})`);

// Cypher
await db.execute(`CREATE (p:Person {name: 'Bob'})`, { language: 'cypher' });

// SPARQL
await db.execute(`
  PREFIX foaf: <http://xmlns.com/foaf/0.1/>
  SELECT ?name WHERE { ?p foaf:name ?name }
`, { language: 'sparql' });

// GraphQL
await db.execute(`
  query { persons { name } }
`, { language: 'graphql' });

// Gremlin
await db.execute(`g.V().hasLabel('Person').values('name')`, { language: 'gremlin' });
```

## Bundle Size

| Import | Size (gzip) |
|--------|-------------|
| `@grafeo-db/web` | ~800 KB |
| `@grafeo-db/web/lite` | ~400 KB (GQL only) |

### Lite Build

```typescript
// Smaller bundle, GQL only
import { GrafeoDB } from '@grafeo-db/web/lite';
```

## Browser Support

| Browser | Version |
|---------|---------|
| Chrome | 89+ |
| Firefox | 89+ |
| Safari | 15+ |
| Edge | 89+ |

Requires WebAssembly, IndexedDB, and Web Workers.

## Limitations

| Constraint | Limit |
|------------|-------|
| Database size | ~500 MB (IndexedDB quota) |
| Memory | ~256 MB (WASM heap) |
| Concurrency | Single writer, multiple readers |

For larger datasets, use [Grafeo](https://github.com/GrafeoDB/grafeo) server-side.

## When to Use

**Good fit:**
- Offline-first applications
- Privacy-sensitive data (never leaves browser)
- Local-first software
- Prototypes and demos
- PWAs

**Not a fit:**
- Large datasets (> 500 MB)
- Multi-device sync (no built-in sync)
- Server-side rendering

## Related

| Package | Use Case |
|---------|----------|
| [`@grafeo-db/js`](https://www.npmjs.com/package/@grafeo-db/js) | Node.js, Deno, Edge runtimes |
| [`@grafeo-db/wasm`](https://www.npmjs.com/package/@grafeo-db/wasm) | Raw WASM binary |
| [`grafeo`](https://crates.io/crates/grafeo) | Rust crate |
| [`grafeo`](https://pypi.org/project/grafeo/) | Python bindings |

## License

Apache-2.0
