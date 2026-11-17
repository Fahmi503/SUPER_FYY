import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { sanitizeMetadata } from "../security/redactor.js";

export type DecisionStatus =
  | "PROPOSED"
  | "ACCEPTED"
  | "REJECTED"
  | "SUPERSEDED"
  | "DEPRECATED";

export interface DecisionRecord {
  id: string;
  project_id: string;
  task_id: string | null;
  title: string;
  context: string;
  decision: string;
  reason: string;
  consequences: string | null;
  evidence_json: string;
  created_by: string;
  approved_by: string | null;
  status: DecisionStatus;
  superseded_decision_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DecisionInput {
  id?: string;
  taskId?: string;
  title: string;
  context: string;
  decision: string;
  reason: string;
  consequences?: string;
  evidence?: Record<string, unknown>;
  createdBy: string;
  approvedBy?: string;
  status?: DecisionStatus;
}

export interface ContradictionReport {
  contradictionDetected: boolean;
  conflictingDecisionId?: string;
  conflictingDecisionTitle?: string;
  reason: string;
  recommendation: string;
}

export class DecisionLedger {
  private db: DatabaseSync;
  public readonly projectId: string;

  constructor(db: DatabaseSync, projectId: string) {
    this.db = db;
    this.projectId = projectId;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_id TEXT,
        title TEXT NOT NULL,
        context TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT NOT NULL,
        consequences TEXT,
        evidence_json TEXT DEFAULT '{}',
        created_by TEXT NOT NULL,
        approved_by TEXT,
        status TEXT NOT NULL DEFAULT 'PROPOSED',
        superseded_decision_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_decisions_proj ON decisions(project_id);
      CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);
    `);
  }

  public recordDecision(input: DecisionInput): DecisionRecord {
    const id = input.id || `dec_${crypto.randomBytes(6).toString("hex")}`;
    const now = new Date().toISOString();
    const cleanMeta = sanitizeMetadata(input.evidence || {});
    const evidenceJson = JSON.stringify(cleanMeta);
    const status = input.status || (input.approvedBy ? "ACCEPTED" : "PROPOSED");

    const stmt = this.db.prepare(`
      INSERT INTO decisions (
        id, project_id, task_id, title, context, decision, reason, consequences,
        evidence_json, created_by, approved_by, status, superseded_decision_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `);

    stmt.run(
      id,
      this.projectId,
      input.taskId || null,
      input.title,
      input.context,
      input.decision,
      input.reason,
      input.consequences || null,
      evidenceJson,
      input.createdBy,
      input.approvedBy || null,
      status,
      now,
      now
    );

    return this.getDecision(id)!;
  }

  public getDecision(id: string): DecisionRecord | null {
    const stmt = this.db.prepare("SELECT * FROM decisions WHERE id = ?");
    const row = stmt.get(id) as unknown as DecisionRecord | undefined;
    return row || null;
  }

  public acceptDecision(id: string, approvedBy: string): DecisionRecord {
    const existing = this.getDecision(id);
    if (!existing) throw new Error(`Decision not found: ${id}`);

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE decisions SET status = 'ACCEPTED', approved_by = ?, updated_at = ? WHERE id = ?
    `).run(approvedBy, now, id);

    return this.getDecision(id)!;
  }

  public supersedeDecision(
    oldDecisionId: string,
    newDecision: DecisionInput
  ): { oldDecision: DecisionRecord; newDecision: DecisionRecord } {
    const old = this.getDecision(oldDecisionId);
    if (!old) throw new Error(`Original decision to supersede not found: ${oldDecisionId}`);

    const now = new Date().toISOString();
    const newId = newDecision.id || `dec_${crypto.randomBytes(6).toString("hex")}`;
    const cleanMeta = sanitizeMetadata(newDecision.evidence || {});
    const evidenceJson = JSON.stringify(cleanMeta);
    const status = newDecision.status || "ACCEPTED";

    // Mark old as SUPERSEDED
    this.db.prepare(`
      UPDATE decisions SET status = 'SUPERSEDED', updated_at = ? WHERE id = ?
    `).run(now, oldDecisionId);

    // Insert new referencing old
    this.db.prepare(`
      INSERT INTO decisions (
        id, project_id, task_id, title, context, decision, reason, consequences,
        evidence_json, created_by, approved_by, status, superseded_decision_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId,
      this.projectId,
      newDecision.taskId || null,
      newDecision.title,
      newDecision.context,
      newDecision.decision,
      newDecision.reason,
      newDecision.consequences || null,
      evidenceJson,
      newDecision.createdBy,
      newDecision.approvedBy || null,
      status,
      oldDecisionId,
      now,
      now
    );

    return {
      oldDecision: this.getDecision(oldDecisionId)!,
      newDecision: this.getDecision(newId)!
    };
  }

  public listDecisions(filter: { status?: DecisionStatus } = {}): DecisionRecord[] {
    if (filter.status) {
      return this.db.prepare(`
        SELECT * FROM decisions WHERE project_id = ? AND status = ? ORDER BY created_at DESC
      `).all(this.projectId, filter.status) as unknown as DecisionRecord[];
    }
    return this.db.prepare(`
      SELECT * FROM decisions WHERE project_id = ? ORDER BY created_at DESC
    `).all(this.projectId) as unknown as DecisionRecord[];
  }

  /**
   * Scans a proposed action or statement for direct contradictions with active ACCEPTED decisions.
   */
  public detectContradictions(statement: string): ContradictionReport[] {
    const accepted = this.listDecisions({ status: "ACCEPTED" });
    const reports: ContradictionReport[] = [];
    const stmtLower = statement.toLowerCase();

    for (const d of accepted) {
      const decLower = d.decision.toLowerCase();
      const titleLower = d.title.toLowerCase();

      // Heuristic conflict detection patterns
      const conflictingKeywords: [string, string][] = [
        ["sqlite", "mysql"],
        ["electron", "tauri"],
        ["read-only", "modify"],
        ["read-only", "delete"],
        ["zero touch", "alter"],
        ["prohibit", "allow"],
        ["disallow", "enable"]
      ];

      for (const [kw1, kw2] of conflictingKeywords) {
        if (
          (decLower.includes(kw1) || titleLower.includes(kw1)) &&
          stmtLower.includes(kw2) &&
          !stmtLower.includes(kw1)
        ) {
          reports.push({
            contradictionDetected: true,
            conflictingDecisionId: d.id,
            conflictingDecisionTitle: d.title,
            reason: `Proposed statement/action suggests '${kw2}', which directly conflicts with accepted decision ${d.id} ('${d.title}') mandating '${kw1}'.`,
            recommendation: `Seek explicit user approval to supersede decision ${d.id} before proceeding.`
          });
          break;
        }
      }
    }

    return reports;
  }
}
