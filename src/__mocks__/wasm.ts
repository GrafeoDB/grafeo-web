/**
 * Mock for @grafeo-db/wasm used in tests.
 *
 * Simulates a basic in-memory graph database with INSERT/MATCH support.
 * Matches the WASM 0.5.0 API surface.
 */

interface Node {
  labels: string[];
  properties: Record<string, unknown>;
}

interface Edge {
  type: string;
  sourceIdx: number;
  targetIdx: number;
  properties: Record<string, unknown>;
}

export class Database {
  private nodes: Node[] = [];
  private edges: Edge[] = [];
  private freed = false;

  constructor() {
    // no-op
  }

  execute(query: string): Record<string, unknown>[] {
    this.assertNotFreed();

    const trimmed = query.trim();

    // Simple INSERT parser
    if (/^INSERT\b/i.test(trimmed)) {
      return this.handleInsert(trimmed);
    }

    // Simple MATCH parser
    if (/^MATCH\b/i.test(trimmed)) {
      return this.handleMatch(trimmed);
    }

    throw new Error(`Mock: unsupported query: ${trimmed.slice(0, 50)}`);
  }

  executeRaw(query: string): {
    columns: string[];
    rows: unknown[][];
    executionTimeMs?: number;
  } {
    this.assertNotFreed();
    const results = this.execute(query);
    if (results.length === 0) {
      return { columns: [], rows: [], executionTimeMs: 0.1 };
    }
    const columns = Object.keys(results[0]);
    const rows = results.map((row) => columns.map((col) => row[col]));
    return { columns, rows, executionTimeMs: 0.1 };
  }

  executeWithLanguage(
    query: string,
    language: string,
  ): Record<string, unknown>[] {
    this.assertNotFreed();
    const supported = ['gql', 'cypher', 'sparql', 'gremlin', 'graphql'];
    if (!supported.includes(language)) {
      throw new Error(
        `Unknown query language: '${language}'. Supported: ${supported.join(', ')}`,
      );
    }
    // In the mock, all languages delegate to the same GQL-like parser
    return this.execute(query);
  }

  nodeCount(): number {
    this.assertNotFreed();
    return this.nodes.length;
  }

  edgeCount(): number {
    this.assertNotFreed();
    return this.edges.length;
  }

  schema(): unknown {
    this.assertNotFreed();
    const labels = [...new Set(this.nodes.flatMap((n) => n.labels))];
    const edgeTypes = [...new Set(this.edges.map((e) => e.type))];
    const propertyKeys = [
      ...new Set(this.nodes.flatMap((n) => Object.keys(n.properties))),
    ];
    return { lpg: { labels, edgeTypes, propertyKeys } };
  }

  static version(): string {
    return '0.5.0-mock';
  }

  exportSnapshot(): Uint8Array {
    this.assertNotFreed();
    const data = JSON.stringify({ nodes: this.nodes, edges: this.edges });
    return new TextEncoder().encode(data);
  }

  static importSnapshot(data: Uint8Array): Database {
    const json = new TextDecoder().decode(data);
    const parsed = JSON.parse(json) as { nodes: Node[]; edges: Edge[] };
    const db = new Database();
    db.nodes = parsed.nodes;
    db.edges = parsed.edges;
    return db;
  }

  free(): void {
    this.freed = true;
    this.nodes = [];
    this.edges = [];
  }

  private assertNotFreed(): void {
    if (this.freed) {
      throw new Error('Database has been freed');
    }
  }

  private handleInsert(query: string): Record<string, unknown>[] {
    // Parse: INSERT (:Label {key: 'value', ...})
    const nodePattern = /\(:(\w+)\s*\{([^}]*)\}\)/g;
    let match;

    while ((match = nodePattern.exec(query)) !== null) {
      const label = match[1];
      const propsStr = match[2];
      const properties = this.parseProperties(propsStr);
      this.nodes.push({ labels: [label], properties });
    }

    // Parse edges: -[:TYPE]->
    const edgePattern = /-\[:(\w+)\]->/g;
    while ((match = edgePattern.exec(query)) !== null) {
      const type = match[1];
      // Connect the last two nodes
      if (this.nodes.length >= 2) {
        this.edges.push({
          type,
          sourceIdx: this.nodes.length - 2,
          targetIdx: this.nodes.length - 1,
          properties: {},
        });
      }
    }

    return [];
  }

  private handleMatch(query: string): Record<string, unknown>[] {
    // Parse: MATCH (var:Label) ... RETURN var.prop, ...
    const returnMatch = /RETURN\s+(.+)$/i.exec(query);
    if (!returnMatch) return [];

    const returnCols = returnMatch[1].split(',').map((c) => c.trim());

    // Find label constraint if any
    const labelMatch = /\(\w+:(\w+)\)/i.exec(query);
    const labelFilter = labelMatch ? labelMatch[1] : null;

    const matchingNodes = labelFilter
      ? this.nodes.filter((n) => n.labels.includes(labelFilter))
      : this.nodes;

    return matchingNodes.map((node) => {
      const row: Record<string, unknown> = {};
      for (const col of returnCols) {
        // Handle "var.prop" style
        const propMatch = /\w+\.(\w+)/.exec(col);
        if (propMatch) {
          const propName = propMatch[1];
          row[col] = node.properties[propName] ?? null;
        }
      }
      return row;
    });
  }

  private parseProperties(str: string): Record<string, unknown> {
    const props: Record<string, unknown> = {};
    // Match key: 'string' or key: number
    const propPattern = /(\w+)\s*:\s*(?:'([^']*)'|"([^"]*)"|(\d+(?:\.\d+)?))/g;
    let match;
    while ((match = propPattern.exec(str)) !== null) {
      const key = match[1];
      if (match[2] !== undefined) props[key] = match[2];
      else if (match[3] !== undefined) props[key] = match[3];
      else if (match[4] !== undefined) props[key] = Number(match[4]);
    }
    return props;
  }
}

export default async function init(): Promise<void> {
  // no-op: WASM init is mocked
}
