/**
 * Mock for @grafeo-db/wasm used in tests.
 *
 * Simulates a basic in-memory graph database with INSERT/MATCH support.
 * Matches the WASM 0.5.42 API surface.
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
  private schemaName: string | undefined = undefined;
  private projections = new Map<string, { nodeLabels?: string[]; edgeTypes?: string[] }>();
  private inTransaction = false;
  private txSnapshot: { nodes: Node[]; edges: Edge[] } | undefined = undefined;

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
    const supported = ['gql', 'cypher', 'sparql', 'gremlin', 'graphql', 'sql'];
    if (!supported.includes(language)) {
      throw new Error(
        `Unknown query language: '${language}'. Supported: ${supported.join(', ')}`,
      );
    }
    // In the mock, all languages delegate to the same GQL-like parser
    return this.execute(query);
  }

  executeWithParams(
    query: string,
    _params: object,
  ): Record<string, unknown>[] {
    this.assertNotFreed();
    return this.execute(query);
  }

  executeWithLanguageAndParams(
    query: string,
    language: string,
    _params: object,
  ): Record<string, unknown>[] {
    this.assertNotFreed();
    return this.executeWithLanguage(query, language);
  }

  executeRawWithLanguage(
    query: string,
    _language: string,
  ): { columns: string[]; rows: unknown[][]; executionTimeMs?: number } {
    this.assertNotFreed();
    return this.executeRaw(query);
  }

  createTextIndex(_label: string, _property: string): void {
    this.assertNotFreed();
  }

  dropTextIndex(_label: string, _property: string): boolean {
    this.assertNotFreed();
    return false;
  }

  rebuildTextIndex(_label: string, _property: string): void {
    this.assertNotFreed();
  }

  textSearch(
    _label: string,
    _property: string,
    _query: string,
    _k: number,
  ): { id: number; score: number }[] {
    this.assertNotFreed();
    return [];
  }

  hybridSearch(
    _label: string,
    _textProp: string,
    _vectorProp: string,
    _queryText: string,
    _k: number,
  ): { id: number; score: number }[] {
    this.assertNotFreed();
    return [];
  }

  createVectorIndex(_label: string, _property: string, _options?: object): void {
    this.assertNotFreed();
  }

  dropVectorIndex(_label: string, _property: string): boolean {
    this.assertNotFreed();
    return false;
  }

  rebuildVectorIndex(_label: string, _property: string): void {
    this.assertNotFreed();
  }

  vectorSearch(
    _label: string,
    _property: string,
    _query: Float32Array,
    _k: number,
    _options?: object,
  ): { id: number; distance: number }[] {
    this.assertNotFreed();
    return [];
  }

  mmrSearch(
    _label: string,
    _property: string,
    _query: Float32Array,
    _k: number,
    _options?: object,
  ): { id: number; distance: number }[] {
    this.assertNotFreed();
    return [];
  }

  memoryUsage(): object {
    this.assertNotFreed();
    return {
      total_bytes: 0,
      store: { total_bytes: 0 },
      indexes: { total_bytes: 0 },
      mvcc: { total_bytes: 0 },
      caches: { total_bytes: 0 },
      string_pool: { total_bytes: 0 },
      buffer_manager: { total_bytes: 0 },
    };
  }

  importRows(
    rows: Record<string, unknown>[],
    _options: object,
  ): number {
    this.assertNotFreed();
    return rows.length;
  }

  importLpg(data: {
    nodes: Array<{ labels: string[]; properties?: Record<string, unknown> }>;
    edges: Array<{ source: number; target: number; type: string; properties?: Record<string, unknown> }>;
  }): { nodes: number; edges: number } {
    this.assertNotFreed();
    const startIdx = this.nodes.length;
    for (const node of data.nodes) {
      this.nodes.push({ labels: node.labels, properties: node.properties ?? {} });
    }
    for (const edge of data.edges) {
      this.edges.push({
        type: edge.type,
        sourceIdx: startIdx + edge.source,
        targetIdx: startIdx + edge.target,
        properties: edge.properties ?? {},
      });
    }
    return { nodes: data.nodes.length, edges: data.edges.length };
  }

  importRdf(_data: {
    triples: Array<{
      subject: string;
      predicate: string;
      object: string | { value: string; datatype?: string; language?: string };
    }>;
  }): { triples: number } {
    this.assertNotFreed();
    return { triples: _data.triples.length };
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
    const labelSet = [...new Set(this.nodes.flatMap((n) => n.labels))];
    const labels = labelSet.map((name) => ({
      name,
      count: this.nodes.filter((n) => n.labels.includes(name)).length,
    }));
    const edge_types = [...new Set(this.edges.map((e) => e.type))];
    const property_keys = [
      ...new Set(this.nodes.flatMap((n) => Object.keys(n.properties))),
    ];
    return { mode: 'lpg', labels, edge_types, property_keys };
  }

  setSchema(name: string): void {
    this.assertNotFreed();
    this.schemaName = name;
  }

  resetSchema(): void {
    this.assertNotFreed();
    this.schemaName = undefined;
  }

  currentSchema(): string | undefined {
    this.assertNotFreed();
    return this.schemaName;
  }

  createProjection(
    name: string,
    nodeLabels?: string[],
    edgeTypes?: string[],
  ): boolean {
    this.assertNotFreed();
    if (this.projections.has(name)) return false;
    this.projections.set(name, { nodeLabels, edgeTypes });
    return true;
  }

  dropProjection(name: string): boolean {
    this.assertNotFreed();
    return this.projections.delete(name);
  }

  listProjections(): string[] {
    this.assertNotFreed();
    return [...this.projections.keys()];
  }

  clearPlanCache(): void {
    this.assertNotFreed();
  }

  compact(): void {
    this.assertNotFreed();
  }

  info(): object {
    this.assertNotFreed();
    return {
      mode: 'Lpg',
      node_count: this.nodes.length,
      edge_count: this.edges.length,
      is_persistent: false,
      path: null,
      wal_enabled: false,
      version: '0.5.42-mock',
      features: ['gql'],
    };
  }

  static version(): string {
    return '0.5.36-mock';
  }

  exportSnapshot(): Uint8Array {
    this.assertNotFreed();
    // Projections are intentionally excluded: they are transient in-memory
    // views in the real engine, rebuilt from the graph store on demand.
    const data = JSON.stringify({ nodes: this.nodes, edges: this.edges });
    return new TextEncoder().encode(data);
  }

  exportSnapshotSigned(key: Uint8Array): Uint8Array {
    this.assertNotFreed();
    if (key.length === 0) {
      throw new Error('exportSnapshotSigned: key must not be empty');
    }
    // Mock does not perform real HMAC: prefixes with GSN1 and appends the
    // key bytes as a placeholder tag. Real integrity checking lives in the
    // WASM crate's signed_snapshot module.
    const payload = this.exportSnapshot();
    const header = new TextEncoder().encode('GSN1');
    const out = new Uint8Array(header.length + payload.length + 32);
    out.set(header, 0);
    out.set(payload, header.length);
    // Placeholder "tag" so tests can exercise the importSnapshotSigned branch.
    for (let i = 0; i < 32; i++) {
      out[out.length - 32 + i] = key[i % key.length]!;
    }
    return out;
  }

  static importSnapshot(data: Uint8Array): Database {
    const header = new TextDecoder().decode(data.slice(0, 4));
    if (header === 'GSN1') {
      throw new Error(
        'importSnapshot: this snapshot was produced by exportSnapshotSigned. ' +
          'Use importSnapshotSigned(data, key) to verify and restore it.',
      );
    }
    const json = new TextDecoder().decode(data);
    const parsed = JSON.parse(json) as { nodes: Node[]; edges: Edge[] };
    const db = new Database();
    db.nodes = parsed.nodes;
    db.edges = parsed.edges;
    return db;
  }

  static importSnapshotSigned(data: Uint8Array, key: Uint8Array): Database {
    if (key.length === 0) {
      throw new Error('importSnapshotSigned: key must not be empty');
    }
    if (data.length < 36) {
      throw new Error('importSnapshotSigned: snapshot too small');
    }
    const header = new TextDecoder().decode(data.slice(0, 4));
    if (header !== 'GSN1') {
      throw new Error(
        'importSnapshotSigned: missing GSN1 header; use importSnapshot for unsigned data',
      );
    }
    // Verify placeholder tag matches wrap() logic.
    const tag = data.slice(data.length - 32);
    for (let i = 0; i < 32; i++) {
      if (tag[i] !== key[i % key.length]) {
        throw new Error('importSnapshotSigned: HMAC verification failed');
      }
    }
    const payload = data.slice(4, data.length - 32);
    return Database.importSnapshot(payload);
  }

  beginTransaction(): void {
    this.assertNotFreed();
    if (this.inTransaction) {
      throw new Error('Transaction already active');
    }
    this.inTransaction = true;
    this.txSnapshot = {
      nodes: this.nodes.map((n) => ({ ...n })),
      edges: this.edges.map((e) => ({ ...e })),
    };
  }

  commitTransaction(): void {
    this.assertNotFreed();
    if (!this.inTransaction) {
      throw new Error('No active transaction to commit');
    }
    this.inTransaction = false;
    this.txSnapshot = undefined;
  }

  rollbackTransaction(): void {
    this.assertNotFreed();
    if (!this.inTransaction) {
      throw new Error('No active transaction to roll back');
    }
    if (this.txSnapshot) {
      this.nodes = this.txSnapshot.nodes;
      this.edges = this.txSnapshot.edges;
    }
    this.inTransaction = false;
    this.txSnapshot = undefined;
  }

  isTransactionActive(): boolean {
    return !this.freed && this.inTransaction;
  }

  close(): void {
    if (this.freed) return;
    if (this.inTransaction) {
      this.rollbackTransaction();
    }
    this.freed = true;
  }

  free(): void {
    this.freed = true;
    this.nodes = [];
    this.edges = [];
    this.projections.clear();
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
