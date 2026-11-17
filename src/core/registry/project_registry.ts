import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

export interface ProjectRecord {
  id: string;
  name: string;
  canonical_path: string;
  technology: string;
  git_remote?: string;
  active_branch?: string;
  registered_at: string;
  last_accessed_at: string;
  memory_db_path: string;
  is_archived: number;
}

export class ProjectRegistry {
  private db: DatabaseSync;
  public readonly dataDir: string;

  constructor(customDataDir?: string) {
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "C:\\Users\\Default", "AppData", "Local");
    this.dataDir = customDataDir || process.env.SUPER_FYY_DATA_DIR || path.join(localAppData, "SuperFyy");

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    const registryDbPath = path.join(this.dataDir, "registry.db");
    this.db = new DatabaseSync(registryDbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        canonical_path TEXT UNIQUE NOT NULL,
        technology TEXT NOT NULL,
        git_remote TEXT,
        active_branch TEXT,
        registered_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        memory_db_path TEXT NOT NULL,
        is_archived INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(canonical_path);
    `);
  }

  public registerProject(params: {
    id?: string;
    name: string;
    canonicalPath: string;
    technology?: string;
    gitRemote?: string;
    activeBranch?: string;
  }): ProjectRecord {
    const canonical = path.resolve(params.canonicalPath);
    if (!fs.existsSync(canonical)) {
      throw new Error(`Target project directory does not exist: ${canonical}`);
    }

    // Check if path already registered
    const existing = this.getProjectByPath(canonical);
    if (existing) {
      return existing;
    }

    const id = params.id || `proj_${crypto.randomBytes(6).toString("hex")}`;
    const now = new Date().toISOString();

    const projectDir = path.join(this.dataDir, "projects", id);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    const memoryDbPath = path.join(projectDir, "memory.db");

    const stmt = this.db.prepare(`
      INSERT INTO projects (
        id, name, canonical_path, technology, git_remote, active_branch,
        registered_at, last_accessed_at, memory_db_path, is_archived
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    stmt.run(
      id,
      params.name,
      canonical,
      params.technology || "Generic",
      params.gitRemote || null,
      params.activeBranch || null,
      now,
      now,
      memoryDbPath
    );

    return this.getProject(id)!;
  }

  public getProject(idOrName: string): ProjectRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM projects 
      WHERE id = ? 
         OR LOWER(name) = LOWER(?) 
         OR LOWER(REPLACE(name, ' ', '_')) = LOWER(?)
    `);
    const row = stmt.get(idOrName, idOrName, idOrName) as unknown as ProjectRecord | undefined;
    return row || null;
  }

  public getProjectByPath(canonicalPath: string): ProjectRecord | null {
    const canonical = path.resolve(canonicalPath);
    const stmt = this.db.prepare("SELECT * FROM projects WHERE canonical_path = ?");
    const row = stmt.get(canonical) as unknown as ProjectRecord | undefined;
    return row || null;
  }

  public listProjects(includeArchived: boolean = false): ProjectRecord[] {
    const sql = includeArchived
      ? "SELECT * FROM projects ORDER BY last_accessed_at DESC"
      : "SELECT * FROM projects WHERE is_archived = 0 ORDER BY last_accessed_at DESC";
    return this.db.prepare(sql).all() as unknown as ProjectRecord[];
  }

  public touchProjectAccess(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE projects SET last_accessed_at = ? WHERE id = ?").run(now, id);
  }

  public archiveProject(id: string): void {
    this.db.prepare("UPDATE projects SET is_archived = 1 WHERE id = ?").run(id);
  }

  public unarchiveProject(id: string): void {
    this.db.prepare("UPDATE projects SET is_archived = 0 WHERE id = ?").run(id);
  }

  /**
   * Removes project from registry.
   * STRICT SAFETY: NEVER deletes the actual project folder or code!
   */
  public removeProject(id: string): boolean {
    const stmt = this.db.prepare("DELETE FROM projects WHERE id = ?");
    const res = stmt.run(id);
    return res.changes > 0;
  }

  public close(): void {
    this.db.close();
  }
}
