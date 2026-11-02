/**
 * Mock for @grafeo-db/wasm used in tests.
 *
 * Simulates a basic in-memory graph database with INSERT/MATCH support.
 * Matches the WASM 0.6.1 API surface.
 */

interface Node {
  labels: string[];
  properties: Record<string, unknown>;
  /** A deleted node keeps its slot: an ID is an index here, and the engine never reuses one. */
  deleted?: boolean;
}

interface Edge {
  type: string;
  sourceIdx: number;
  targetIdx: number;
  properties: Record<string, unknown>;
  /** As for a node: an edge ID is an index here. */
  deleted?: boolean;
}

/** The schema() name of a property's value type. */
function typeName(value: unknown): string {
  if (typeof value === 'string') return 'STRING';
  if (typeof value === 'boolean') return 'BOOL';
  if (typeof value === 'number') return Number.isInteger(value) ? 'INT64' : 'FLOAT64';
  return Array.isArray(value) ? 'LIST' : 'MAP';
}

/** The schema() properties of these elements, sorted by name. */
function schemaProperties(elements: { properties: Record<string, unknown> }[]) {
  const types = new Map<string, Set<string>>();
  for (const { properties } of elements) {
    for (const [name, value] of Object.entries(properties)) {
      if (!types.has(name)) types.set(name, new Set());
      types.get(name)!.add(typeName(value));
    }
  }
  return [...types.keys()].sort().map((name) => ({ name, types: [...types.get(name)!].sort() }));
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

  private get liveNodes(): Node[] {
    return this.nodes.filter((n) => !n.deleted);
  }

  private get liveEdges(): Edge[] {
    return this.edges.filter((e) => !e.deleted);
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
    const supported = ['gql', 'cypher', 'sparql', 'gremlin', 'graphql', 'graphql-rdf', 'sql', 'sql-pgq'];
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

  executeRawWithParams(
    query: string,
    _params: object,
  ): { columns: string[]; rows: unknown[][]; executionTimeMs?: number } {
    this.assertNotFreed();
    return this.executeRaw(query);
  }

  executeRawWithLanguageAndParams(
    query: string,
    _language: string,
    _params: object,
  ): { columns: string[]; rows: unknown[][]; executionTimeMs?: number } {
    this.assertNotFreed();
    return this.executeRaw(query);
  }

  createTextIndex(_label: string, _property: string, _options?: object): void {
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
    _options?: object,
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
    _options?: object,
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
    // Like the real binding (0.6): all or nothing, so a bad edge index fails
    // the call before anything is written.
    for (const [i, edge] of data.edges.entries()) {
      for (const end of ['source', 'target'] as const) {
        if (edge[end] < 0 || edge[end] >= data.nodes.length) {
          throw new Error(
            `edges[${i}].${end} index ${edge[end]} out of bounds (0..${data.nodes.length})`,
          );
        }
      }
    }
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

  batchCreateNodesWithProps(labels: string | string[], rows: Record<string, unknown>[]): number[] {
    this.assertNotFreed();
    this.assertNoBatchInTransaction('batchCreateNodesWithProps');
    const labelList = typeof labels === 'string' ? [labels] : labels;
    return rows.map((properties) => this.nodes.push({ labels: [...labelList], properties: { ...properties } }) - 1);
  }

  batchCreateEdges(
    edges: Array<{ src: number; dst: number; type: string; properties?: Record<string, unknown> }>,
  ): number[] {
    this.assertNotFreed();
    this.assertNoBatchInTransaction('batchCreateEdges');
    for (const edge of edges) {
      for (const end of [edge.src, edge.dst]) {
        if (end < 0 || end >= this.nodes.length || this.nodes[end].deleted) {
          throw new Error(`GRAFEO-V002: Node not found: ${end}`);
        }
      }
    }
    return edges.map(
      (edge) =>
        this.edges.push({
          type: edge.type,
          sourceIdx: edge.src,
          targetIdx: edge.dst,
          properties: { ...(edge.properties ?? {}) },
        }) - 1,
    );
  }

  upsertNodes(
    labels: string | string[],
    rows: Record<string, unknown>[],
    options?: { key?: string; replace?: boolean },
  ): { created: number; updated: number; skipped: number; skippedRows: number[] } {
    this.assertNotFreed();
    const labelList = typeof labels === 'string' ? [labels] : labels;
    const key = options?.key ?? 'id';
    const summary = { created: 0, updated: 0, skipped: 0, skippedRows: [] as number[] };
    for (const [i, row] of rows.entries()) {
      if (!(key in row)) {
        summary.skipped++;
        summary.skippedRows.push(i);
        continue;
      }
      const match = this.liveNodes.find(
        (n) => labelList.every((l) => n.labels.includes(l)) && n.properties[key] === row[key],
      );
      if (match) {
        match.properties = options?.replace ? { ...row } : { ...match.properties, ...row };
        summary.updated++;
      } else {
        this.nodes.push({ labels: [...labelList], properties: { ...row } });
        summary.created++;
      }
    }
    return summary;
  }

  upsertEdges(
    _edgeType: string,
    rows: Record<string, unknown>[],
    _options?: object,
  ): { created: number; updated: number; skipped: number; skippedRows: number[] } {
    this.assertNotFreed();
    // The mock matches no endpoints: every row is skipped.
    return { created: 0, updated: 0, skipped: rows.length, skippedRows: rows.map((_, i) => i) };
  }

  getNodeEdges(id: number, options?: { direction?: string; edgeTypes?: string[] }): [number, number][] {
    this.assertNotFreed();
    const direction = options?.direction ?? 'out';
    const pairs: [number, number][] = [];
    for (const [edgeId, edge] of this.edges.entries()) {
      if (edge.deleted || (options?.edgeTypes && !options.edgeTypes.includes(edge.type))) continue;
      if ((direction === 'out' || direction === 'both') && edge.sourceIdx === id) {
        pairs.push([edge.targetIdx, edgeId]);
      } else if ((direction === 'in' || direction === 'both') && edge.targetIdx === id) {
        pairs.push([edge.sourceIdx, edgeId]);
      }
    }
    return pairs;
  }

  batchVectorSearch(
    _label: string,
    _property: string,
    queries: (Float32Array | number[])[],
    _k: number,
    _options?: object,
  ): { id: number; distance: number }[][] {
    this.assertNotFreed();
    return queries.map(() => []);
  }

  nodeCount(): number {
    this.assertNotFreed();
    return this.liveNodes.length;
  }

  edgeCount(): number {
    this.assertNotFreed();
    return this.liveEdges.length;
  }

  detachDeleteNode(id: number): boolean {
    this.assertNotFreed();
    if (!Number.isSafeInteger(id) || id < 0) {
      throw new Error(`${id} is not a node ID`);
    }
    if (id >= this.nodes.length || this.nodes[id].deleted) return false;
    this.nodes[id] = { ...this.nodes[id], deleted: true };
    this.edges = this.edges.map((e) => (e.sourceIdx === id || e.targetIdx === id ? { ...e, deleted: true } : e));
    return true;
  }

  schema(): unknown {
    this.assertNotFreed();
    const nodes = this.liveNodes;
    const liveEdges = this.liveEdges;
    const labelSet = [...new Set(nodes.flatMap((n) => n.labels))].sort();
    const labels = labelSet.map((name) => {
      const labeled = nodes.filter((n) => n.labels.includes(name));
      return { name, count: labeled.length, properties: schemaProperties(labeled) };
    });
    const edge_types = [...new Set(liveEdges.map((e) => e.type))].sort().map((name) => {
      const edges = liveEdges.filter((e) => e.type === name);
      const endpoints = new Map<string, { source: string; target: string; count: number }>();
      for (const edge of edges) {
        const source = this.nodes[edge.sourceIdx].labels[0];
        const target = this.nodes[edge.targetIdx].labels[0];
        const endpoint = endpoints.get(`${source}->${target}`) ?? { source, target, count: 0 };
        endpoint.count += 1;
        endpoints.set(`${source}->${target}`, endpoint);
      }
      return { name, count: edges.length, properties: schemaProperties(edges), endpoints: [...endpoints.values()] };
    });
    const property_keys = [
      ...new Set([...nodes, ...liveEdges].flatMap((element) => Object.keys(element.properties))),
    ].sort();
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

  compact(): { checkpointed: boolean; versions_collected: number; rows_compressed: number; duration_ms: number } {
    this.assertNotFreed();
    return { checkpointed: false, versions_collected: 0, rows_compressed: 0, duration_ms: 0 };
  }

  info(): object {
    this.assertNotFreed();
    return {
      mode: 'Lpg',
      node_count: this.liveNodes.length,
      edge_count: this.liveEdges.length,
      is_persistent: false,
      path: null,
      wal_enabled: false,
      version: '0.6.1-mock',
      features: ['gql'],
    };
  }

  static version(): string {
    return '0.6.1-mock';
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

  private assertNoBatchInTransaction(method: string): void {
    if (this.inTransaction) {
      throw new Error(`${method} commits on its own: commit or roll back the open transaction first`);
    }
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

    // Parse edges: -[:TYPE]-> or -[:TYPE {key: 'value', ...}]->
    const edgePattern = /-\[:(\w+)(?:\s*\{([^}]*)\})?\]->/g;
    while ((match = edgePattern.exec(query)) !== null) {
      const type = match[1];
      // Connect the last two nodes
      if (this.nodes.length >= 2) {
        this.edges.push({
          type,
          sourceIdx: this.nodes.length - 2,
          targetIdx: this.nodes.length - 1,
          properties: match[2] ? this.parseProperties(match[2]) : {},
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
      ? this.liveNodes.filter((n) => n.labels.includes(labelFilter))
      : this.liveNodes;

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
