import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { sanitizeMetadata } from "../security/redactor.js";

export type EntityType =
  | "FILE"
  | "FOLDER"
  | "FUNCTION"
  | "CLASS"
  | "MODULE"
  | "TASK"
  | "ISSUE"
  | "DECISION"
  | "DOCUMENT"
  | "TEST"
  | "AGENT"
  | "COMMUNITY"
  | "GIT_COMMIT"
  | "API_ENDPOINT"
  | "DATABASE_TABLE"
  | "UNKNOWN";

export type RelationType =
  | "CONTAINS"
  | "IMPORTS"
  | "DEFINES"
  | "CALLS"
  | "REFERENCES"
  | "DEPENDS_ON"
  | "TESTS"
  | "TESTED_BY"
  | "DOCUMENTS"
  | "USES_TABLE"
  | "REFERENCES_TABLE"
  | "ASSIGNED_TO"
  | "OWNS"
  | "MODIFIES"
  | "VERIFIED_BY"
  | "RELATED_TO"
  | "IMPLEMENTS"
  | "RESOLVES"
  | "DECIDED_BY"
  | "PART_OF"
  | "PRODUCED";

export interface GraphNode {
  id: string;
  project_id: string;
  entity_type: EntityType;
  name: string;
  file_path: string | null;
  summary: string | null;
  full_content: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface GraphEdge {
  id: string;
  project_id: string;
  source_id: string;
  target_id: string;
  relation_type: RelationType;
  weight: number;
  metadata_json: string;
  created_at: string;
}

export interface IndexedFileRecord {
  project_id: string;
  relative_path: string;
  content_hash: string;
  file_size: number;
  last_modified: string;
  last_indexed_at: string;
  status: "ACTIVE" | "STALE" | "REMOVED";
}

export class ProjectMemory {
  private db: DatabaseSync;
  public readonly projectId: string;
  public readonly dbPath: string;

  constructor(dbPath: string, projectId: string) {
    this.projectId = projectId;
    this.dbPath = path.resolve(dbPath);

    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(this.dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS graph_nodes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        name TEXT NOT NULL,
        file_path TEXT,
        summary TEXT,
        full_content TEXT,
        metadata_json TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_type ON graph_nodes(entity_type);
      CREATE INDEX IF NOT EXISTS idx_nodes_path ON graph_nodes(file_path);
      CREATE INDEX IF NOT EXISTS idx_nodes_proj ON graph_nodes(project_id);

      CREATE TABLE IF NOT EXISTS graph_edges (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        metadata_json TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY(source_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
        FOREIGN KEY(target_id) REFERENCES graph_nodes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_edges_source ON graph_edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON graph_edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_edges_rel ON graph_edges(relation_type);

      -- FTS5 Full Text Search index for graph nodes
      CREATE VIRTUAL TABLE IF NOT EXISTS graph_nodes_fts USING fts5(
        node_id UNINDEXED,
        name,
        file_path,
        summary,
        full_content
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'BACKLOG',
        priority TEXT NOT NULL DEFAULT 'MEDIUM',
        assigned_agent TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(assigned_agent);

      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id TEXT NOT NULL,
        depends_on_task_id TEXT NOT NULL,
        PRIMARY KEY (task_id, depends_on_task_id),
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY(depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS task_artifacts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        path_or_uri TEXT NOT NULL,
        metadata_json TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS agent_activities (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_id TEXT,
        agent_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        details_json TEXT DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_act_proj ON agent_activities(project_id);
      CREATE INDEX IF NOT EXISTS idx_agent_act_task ON agent_activities(task_id);

      CREATE TABLE IF NOT EXISTS resource_locks (
        resource_uri TEXT PRIMARY KEY,
        locked_by_agent TEXT NOT NULL,
        project_id TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS indexed_files (
        project_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        last_modified TEXT NOT NULL,
        last_indexed_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        PRIMARY KEY (project_id, relative_path)
      );

      CREATE INDEX IF NOT EXISTS idx_indexed_files_proj ON indexed_files(project_id);
    `);
  }

  // --- Node Operations ---

  public addNode(params: {
    id?: string;
    entityType: EntityType;
    name: string;
    filePath?: string;
    summary?: string;
    fullContent?: string;
    metadata?: Record<string, unknown>;
  }): GraphNode {
    const id = params.id || `node_${crypto.randomBytes(6).toString("hex")}`;
    const now = new Date().toISOString();
    const cleanMeta = sanitizeMetadata(params.metadata || {});
    const metaJson = JSON.stringify(cleanMeta);

    const stmt = this.db.prepare(`
      INSERT INTO graph_nodes (
        id, project_id, entity_type, name, file_path, summary, full_content, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      this.projectId,
      params.entityType,
      params.name,
      params.filePath || null,
      params.summary || null,
      params.fullContent || null,
      metaJson,
      now,
      now
    );

    // Sync to FTS5
    this.db.prepare(`
      INSERT INTO graph_nodes_fts (node_id, name, file_path, summary, full_content)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      id,
      params.name,
      params.filePath || "",
      params.summary || "",
      params.fullContent || ""
    );

    return this.getNode(id)!;
  }

  public getNode(id: string): GraphNode | null {
    const stmt = this.db.prepare("SELECT * FROM graph_nodes WHERE id = ?");
    const row = stmt.get(id) as unknown as GraphNode | undefined;
    return row || null;
  }

  public updateNode(
    id: string,
    updates: {
      name?: string;
      filePath?: string;
      summary?: string;
      fullContent?: string;
      metadata?: Record<string, unknown>;
    }
  ): GraphNode {
    const existing = this.getNode(id);
    if (!existing) {
      throw new Error(`Node not found: ${id}`);
    }

    const now = new Date().toISOString();
    const newName = updates.name !== undefined ? updates.name : existing.name;
    const newPath = updates.filePath !== undefined ? updates.filePath : existing.file_path;
    const newSummary = updates.summary !== undefined ? updates.summary : existing.summary;
    const newContent = updates.fullContent !== undefined ? updates.fullContent : existing.full_content;

    let metaJson = existing.metadata_json;
    if (updates.metadata) {
      const currentMeta = JSON.parse(existing.metadata_json || "{}");
      const merged = { ...currentMeta, ...updates.metadata };
      metaJson = JSON.stringify(sanitizeMetadata(merged));
    }

    this.db.prepare(`
      UPDATE graph_nodes
      SET name = ?, file_path = ?, summary = ?, full_content = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?
    `).run(newName, newPath, newSummary, newContent, metaJson, now, id);

    // Update FTS5
    this.db.prepare("DELETE FROM graph_nodes_fts WHERE node_id = ?").run(id);
    this.db.prepare(`
      INSERT INTO graph_nodes_fts (node_id, name, file_path, summary, full_content)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, newName, newPath || "", newSummary || "", newContent || "");

    return this.getNode(id)!;
  }

  public deleteNode(id: string): boolean {
    this.db.prepare("DELETE FROM graph_nodes_fts WHERE node_id = ?").run(id);
    const res = this.db.prepare("DELETE FROM graph_nodes WHERE id = ?").run(id);
    return res.changes > 0;
  }

  public queryNodes(filter: {
    entityType?: EntityType;
    filePath?: string;
    limit?: number;
  } = {}): GraphNode[] {
    const conditions: string[] = ["project_id = ?"];
    const params: any[] = [this.projectId];

    if (filter.entityType) {
      conditions.push("entity_type = ?");
      params.push(filter.entityType);
    }
    if (filter.filePath) {
      conditions.push("file_path = ?");
      params.push(filter.filePath);
    }

    const limit = filter.limit && filter.limit > 0 ? filter.limit : 200;
    const sql = `SELECT * FROM graph_nodes WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC LIMIT ${limit}`;
    return this.db.prepare(sql).all(...params) as unknown as GraphNode[];
  }

  public searchFts(query: string, limit: number = 20): GraphNode[] {
    const cleaned = query.replace(/[^\w\s-]/g, " ").trim();
    if (!cleaned) return [];

    const ftsRows = this.db.prepare(`
      SELECT node_id FROM graph_nodes_fts WHERE graph_nodes_fts MATCH ? LIMIT ?
    `).all(cleaned, limit) as unknown as { node_id: string }[];

    if (ftsRows.length === 0) return [];

    const ids = ftsRows.map(r => `'${r.node_id}'`).join(",");
    const sql = `SELECT * FROM graph_nodes WHERE id IN (${ids})`;
    return this.db.prepare(sql).all() as unknown as GraphNode[];
  }

  // --- Edge Operations ---

  public addEdge(params: {
    id?: string;
    sourceId: string;
    targetId: string;
    relationType: RelationType;
    weight?: number;
    metadata?: Record<string, unknown>;
  }): GraphEdge {
    const id = params.id || `edge_${crypto.randomBytes(6).toString("hex")}`;
    const now = new Date().toISOString();
    const cleanMeta = sanitizeMetadata(params.metadata || {});
    const metaJson = JSON.stringify(cleanMeta);
    const weight = params.weight !== undefined ? params.weight : 1.0;

    const stmt = this.db.prepare(`
      INSERT INTO graph_edges (
        id, project_id, source_id, target_id, relation_type, weight, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      this.projectId,
      params.sourceId,
      params.targetId,
      params.relationType,
      weight,
      metaJson,
      now
    );

    return this.getEdge(id)!;
  }

  public getEdge(id: string): GraphEdge | null {
    const stmt = this.db.prepare("SELECT * FROM graph_edges WHERE id = ?");
    const row = stmt.get(id) as unknown as GraphEdge | undefined;
    return row || null;
  }

  public deleteEdge(id: string): boolean {
    const res = this.db.prepare("DELETE FROM graph_edges WHERE id = ?").run(id);
    return res.changes > 0;
  }

  public getNeighbors(
    nodeId: string,
    direction: "in" | "out" | "both" = "both"
  ): { node: GraphNode; edge: GraphEdge }[] {
    const results: { node: GraphNode; edge: GraphEdge }[] = [];

    if (direction === "out" || direction === "both") {
      const outEdges = this.db.prepare(
        "SELECT * FROM graph_edges WHERE source_id = ?"
      ).all(nodeId) as unknown as GraphEdge[];

      for (const edge of outEdges) {
        const targetNode = this.getNode(edge.target_id);
        if (targetNode) {
          results.push({ node: targetNode, edge });
        }
      }
    }

    if (direction === "in" || direction === "both") {
      const inEdges = this.db.prepare(
        "SELECT * FROM graph_edges WHERE target_id = ?"
      ).all(nodeId) as unknown as GraphEdge[];

      for (const edge of inEdges) {
        const sourceNode = this.getNode(edge.source_id);
        if (sourceNode) {
          results.push({ node: sourceNode, edge });
        }
      }
    }

    return results;
  }

  public getGraph(filter: { limit?: number; entityTypes?: EntityType[] } = {}): {
    nodes: GraphNode[];
    edges: GraphEdge[];
  } {
    const limit = filter.limit && filter.limit > 0 ? filter.limit : 500;
    let nodeSql = "SELECT * FROM graph_nodes WHERE project_id = ?";
    const params: any[] = [this.projectId];

    if (filter.entityTypes && filter.entityTypes.length > 0) {
      const placeholders = filter.entityTypes.map(() => "?").join(",");
      nodeSql += ` AND entity_type IN (${placeholders})`;
      params.push(...filter.entityTypes);
    }

    nodeSql += ` ORDER BY updated_at DESC LIMIT ${limit}`;
    const nodes = this.db.prepare(nodeSql).all(...params) as unknown as GraphNode[];

    if (nodes.length === 0) {
      return { nodes: [], edges: [] };
    }

    const nodeIds = new Set(nodes.map(n => n.id));
    const allEdges = this.db.prepare(
      "SELECT * FROM graph_edges WHERE project_id = ?"
    ).all(this.projectId) as unknown as GraphEdge[];

    const edges = allEdges.filter(
      e => nodeIds.has(e.source_id) && nodeIds.has(e.target_id)
    );

    return { nodes, edges };
  }

  public withTransaction<T>(fn: () => T): T {
    this.db.exec("BEGIN TRANSACTION;");
    try {
      const res = fn();
      this.db.exec("COMMIT;");
      return res;
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }

  public saveIndexedFile(record: Omit<IndexedFileRecord, "project_id">): void {
    const stmt = this.db.prepare(`
      INSERT INTO indexed_files (
        project_id, relative_path, content_hash, file_size, last_modified, last_indexed_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, relative_path) DO UPDATE SET
        content_hash = excluded.content_hash,
        file_size = excluded.file_size,
        last_modified = excluded.last_modified,
        last_indexed_at = excluded.last_indexed_at,
        status = excluded.status
    `);
    stmt.run(
      this.projectId,
      record.relative_path,
      record.content_hash,
      record.file_size,
      record.last_modified,
      record.last_indexed_at,
      record.status || "ACTIVE"
    );
  }

  public getIndexedFile(relativePath: string): IndexedFileRecord | null {
    const stmt = this.db.prepare("SELECT * FROM indexed_files WHERE project_id = ? AND relative_path = ?");
    const row = stmt.get(this.projectId, relativePath) as unknown as IndexedFileRecord | undefined;
    return row || null;
  }

  public listIndexedFiles(): IndexedFileRecord[] {
    const stmt = this.db.prepare("SELECT * FROM indexed_files WHERE project_id = ?");
    return stmt.all(this.projectId) as unknown as IndexedFileRecord[];
  }

  public markFileStatus(relativePath: string, status: "ACTIVE" | "STALE" | "REMOVED"): void {
    const stmt = this.db.prepare("UPDATE indexed_files SET status = ? WHERE project_id = ? AND relative_path = ?");
    stmt.run(status, this.projectId, relativePath);
  }

  public findNodeByPath(filePath: string): GraphNode | null {
    const stmt = this.db.prepare("SELECT * FROM graph_nodes WHERE project_id = ? AND file_path = ? LIMIT 1");
    const row = stmt.get(this.projectId, filePath) as unknown as GraphNode | undefined;
    return row || null;
  }

  public findNodeByNameAndType(name: string, entityType: EntityType): GraphNode | null {
    const stmt = this.db.prepare("SELECT * FROM graph_nodes WHERE project_id = ? AND name = ? AND entity_type = ? LIMIT 1");
    const row = stmt.get(this.projectId, name, entityType) as unknown as GraphNode | undefined;
    return row || null;
  }

  public removeNodesByFilePath(filePath: string): number {
    const nodes = this.db.prepare("SELECT id FROM graph_nodes WHERE project_id = ? AND file_path = ?").all(this.projectId, filePath) as unknown as { id: string }[];
    for (const n of nodes) {
      this.deleteNode(n.id);
    }
    return nodes.length;
  }

  public getRawDb(): DatabaseSync {
    return this.db;
  }

  public close(): void {
    this.db.close();
  }
}
