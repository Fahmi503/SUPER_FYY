import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { ExecutionContract } from "../security/context_guard.js";

export interface TaskCapsuleRecord {
  task_id: string;
  project_id: string;
  task_name: string;
  user_request: string;
  objective: string;
  in_scope_paths: string[];
  out_of_scope_paths: string[];
  constraints: string[];
  acceptance_criteria: string[];
  known_risks: string[];
  open_questions: string[];
  owner_agent: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface TaskCapsuleInput {
  taskId: string;
  projectId: string;
  taskName: string;
  userRequest: string;
  objective: string;
  inScopePaths?: string[];
  outOfScopePaths?: string[];
  constraints?: string[];
  acceptanceCriteria?: string[];
  knownRisks?: string[];
  openQuestions?: string[];
  ownerAgent?: string;
  status?: string;
}

export class TaskCapsuleManager {
  private db: DatabaseSync;
  public readonly projectId: string;

  constructor(db: DatabaseSync, projectId: string) {
    this.db = db;
    this.projectId = projectId;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_context_capsules (
        task_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_name TEXT NOT NULL,
        user_request TEXT NOT NULL,
        objective TEXT NOT NULL,
        in_scope_json TEXT NOT NULL DEFAULT '[]',
        out_of_scope_json TEXT NOT NULL DEFAULT '[]',
        constraints_json TEXT NOT NULL DEFAULT '[]',
        acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
        known_risks_json TEXT NOT NULL DEFAULT '[]',
        open_questions_json TEXT NOT NULL DEFAULT '[]',
        owner_agent TEXT,
        status TEXT NOT NULL DEFAULT 'CREATED',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_capsules_proj ON task_context_capsules(project_id);
    `);
  }

  public createCapsule(input: TaskCapsuleInput): TaskCapsuleRecord {
    const now = new Date().toISOString();
    const inScope = JSON.stringify(input.inScopePaths || []);
    const outScope = JSON.stringify(input.outOfScopePaths || []);
    const constraints = JSON.stringify(input.constraints || []);
    const criteria = JSON.stringify(input.acceptanceCriteria || []);
    const risks = JSON.stringify(input.knownRisks || []);
    const questions = JSON.stringify(input.openQuestions || []);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO task_context_capsules (
        task_id, project_id, task_name, user_request, objective,
        in_scope_json, out_of_scope_json, constraints_json, acceptance_criteria_json,
        known_risks_json, open_questions_json, owner_agent, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      input.taskId,
      this.projectId,
      input.taskName,
      input.userRequest,
      input.objective,
      inScope,
      outScope,
      constraints,
      criteria,
      risks,
      questions,
      input.ownerAgent || null,
      input.status || "CREATED",
      now,
      now
    );

    return this.getCapsule(input.taskId)!;
  }

  public getCapsule(taskId: string): TaskCapsuleRecord | null {
    const stmt = this.db.prepare("SELECT * FROM task_context_capsules WHERE task_id = ?");
    const row = stmt.get(taskId) as any;
    if (!row) return null;

    return {
      task_id: row.task_id,
      project_id: row.project_id,
      task_name: row.task_name,
      user_request: row.user_request,
      objective: row.objective,
      in_scope_paths: JSON.parse(row.in_scope_json || "[]"),
      out_of_scope_paths: JSON.parse(row.out_of_scope_json || "[]"),
      constraints: JSON.parse(row.constraints_json || "[]"),
      acceptance_criteria: JSON.parse(row.acceptance_criteria_json || "[]"),
      known_risks: JSON.parse(row.known_risks_json || "[]"),
      open_questions: JSON.parse(row.open_questions_json || "[]"),
      owner_agent: row.owner_agent,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  public generateExecutionContract(taskId: string): ExecutionContract {
    const capsule = this.getCapsule(taskId);
    if (!capsule) {
      throw new Error(`Cannot generate contract: Task capsule '${taskId}' not found.`);
    }

    // Extract forbidden operations from constraints
    const forbidden: string[] = [];
    for (const c of capsule.constraints) {
      if (c.toLowerCase().includes("prohibit") || c.toLowerCase().includes("forbidden") || c.toLowerCase().includes("do not") || c.toLowerCase().includes("must not")) {
        forbidden.push(c);
      }
    }

    return {
      taskId: capsule.task_id,
      projectId: capsule.project_id,
      taskName: capsule.task_name,
      inScopePaths: capsule.in_scope_paths,
      outOfScopePaths: capsule.out_of_scope_paths,
      forbiddenOperations: forbidden,
      requiredDecisions: []
    };
  }

  public exportCapsuleMarkdown(taskId: string): string {
    const c = this.getCapsule(taskId);
    if (!c) throw new Error(`Task capsule not found: ${taskId}`);

    return [
      `# Task Context Capsule: ${c.task_name} [${c.task_id}]`,
      `- **Project ID:** ${c.project_id}`,
      `- **Status:** ${c.status}`,
      `- **Owner Agent:** ${c.owner_agent || "Unassigned"}`,
      "",
      `### User Request`,
      c.user_request,
      "",
      `### Objective`,
      c.objective,
      "",
      `### In-Scope Boundaries`,
      c.in_scope_paths.length ? c.in_scope_paths.map(p => `- \`${p}\``).join("\n") : "- (No path restrictions specified)",
      "",
      `### Out-Of-Scope (Strictly Prohibited)`,
      c.out_of_scope_paths.length ? c.out_of_scope_paths.map(p => `- \`${p}\``).join("\n") : "- (None defined)",
      "",
      `### Required Constraints`,
      c.constraints.length ? c.constraints.map(ct => `- ${ct}`).join("\n") : "- (None defined)",
      "",
      `### Acceptance Criteria`,
      c.acceptance_criteria.length ? c.acceptance_criteria.map(ac => `- [ ] ${ac}`).join("\n") : "- (None defined)"
    ].join("\n");
  }
}
