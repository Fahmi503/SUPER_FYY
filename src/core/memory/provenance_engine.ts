import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type VerificationStatus =
  | "VERIFIED"
  | "REPORTED"
  | "UNVERIFIED"
  | "INFERRED"
  | "STALE"
  | "SUPERSEDED"
  | "REJECTED";

export interface EvidenceRecord {
  id: string;
  project_id: string;
  node_id: string | null;
  statement: string;
  source_type: "FILE" | "TEST" | "GIT_COMMIT" | "REPORT" | "INSPECTION";
  source_path: string;
  line_range: string | null;
  file_hash: string | null;
  test_name: string | null;
  report_ref: string | null;
  agent_id: string;
  task_id: string | null;
  status: VerificationStatus;
  created_at: string;
  verified_at: string;
}

export interface EvidenceInput {
  id?: string;
  nodeId?: string;
  statement: string;
  sourceType: "FILE" | "TEST" | "GIT_COMMIT" | "REPORT" | "INSPECTION";
  sourcePath: string;
  lineRange?: string;
  fileHash?: string;
  testName?: string;
  reportRef?: string;
  agentId: string;
  taskId?: string;
  status?: VerificationStatus;
}

export class ProvenanceEngine {
  private db: DatabaseSync;
  public readonly projectId: string;

  constructor(db: DatabaseSync, projectId: string) {
    this.db = db;
    this.projectId = projectId;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_evidence (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        node_id TEXT,
        statement TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_path TEXT NOT NULL,
        line_range TEXT,
        file_hash TEXT,
        test_name TEXT,
        report_ref TEXT,
        agent_id TEXT NOT NULL,
        task_id TEXT,
        status TEXT NOT NULL DEFAULT 'VERIFIED',
        created_at TEXT NOT NULL,
        verified_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_evidence_proj ON memory_evidence(project_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_node ON memory_evidence(node_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_path ON memory_evidence(source_path);
      CREATE INDEX IF NOT EXISTS idx_evidence_status ON memory_evidence(status);
    `);
  }

  public recordEvidence(input: EvidenceInput): EvidenceRecord {
    const id = input.id || `evi_${crypto.randomBytes(6).toString("hex")}`;
    const now = new Date().toISOString();
    const status = input.status || "VERIFIED";

    const stmt = this.db.prepare(`
      INSERT INTO memory_evidence (
        id, project_id, node_id, statement, source_type, source_path, line_range,
        file_hash, test_name, report_ref, agent_id, task_id, status, created_at, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      this.projectId,
      input.nodeId || null,
      input.statement,
      input.sourceType,
      input.sourcePath,
      input.lineRange || null,
      input.fileHash || null,
      input.testName || null,
      input.reportRef || null,
      input.agentId,
      input.taskId || null,
      status,
      now,
      now
    );

    return this.getEvidence(id)!;
  }

  public getEvidence(id: string): EvidenceRecord | null {
    const stmt = this.db.prepare("SELECT * FROM memory_evidence WHERE id = ?");
    const row = stmt.get(id) as unknown as EvidenceRecord | undefined;
    return row || null;
  }

  public getEvidenceForNode(nodeId: string): EvidenceRecord[] {
    return this.db.prepare(`
      SELECT * FROM memory_evidence WHERE node_id = ? ORDER BY verified_at DESC
    `).all(nodeId) as unknown as EvidenceRecord[];
  }

  public computeFileHash(fullPath: string): string | null {
    if (!fs.existsSync(fullPath)) return null;
    const buf = fs.readFileSync(fullPath);
    return crypto.createHash("sha256").update(buf).digest("hex");
  }

  /**
   * Validates whether source file has changed. If changed, marks evidence as STALE.
   */
  public verifyFreshness(projectRoot: string, relativePath: string): {
    fresh: boolean;
    currentHash: string | null;
    storedHash: string | null;
    staleUpdatedCount: number;
  } {
    const normRel = relativePath.replace(/\\/g, "/");
    const full = path.resolve(projectRoot, relativePath);
    const currentHash = this.computeFileHash(full);

    const records = this.db.prepare(`
      SELECT * FROM memory_evidence 
      WHERE project_id = ? AND source_path = ? AND status != 'STALE' AND status != 'SUPERSEDED'
    `).all(this.projectId, normRel) as unknown as EvidenceRecord[];

    let staleCount = 0;
    let storedHash: string | null = null;

    for (const rec of records) {
      storedHash = rec.file_hash;
      if (currentHash === null || (rec.file_hash && rec.file_hash !== currentHash)) {
        // Source modified or deleted -> mark STALE
        this.db.prepare(`
          UPDATE memory_evidence SET status = 'STALE', verified_at = ? WHERE id = ?
        `).run(new Date().toISOString(), rec.id);
        staleCount++;
      }
    }

    return {
      fresh: staleCount === 0 && currentHash !== null,
      currentHash,
      storedHash,
      staleUpdatedCount: staleCount
    };
  }

  public listStaleMemories(): EvidenceRecord[] {
    return this.db.prepare(`
      SELECT * FROM memory_evidence WHERE project_id = ? AND status = 'STALE' ORDER BY verified_at DESC
    `).all(this.projectId) as unknown as EvidenceRecord[];
  }
}
