import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { sanitizeMetadata } from "../security/redactor.js";

export type TaskStatus =
  | "BACKLOG"
  | "TODO"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "REVIEW"
  | "COMPLETED"
  | "CANCELLED";

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface TaskRecord {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_agent: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TaskArtifactRecord {
  id: string;
  task_id: string;
  artifact_type: string;
  path_or_uri: string;
  metadata_json: string;
  created_at: string;
}

export class TaskManager {
  private db: DatabaseSync;
  public readonly projectId: string;

  constructor(db: DatabaseSync, projectId: string) {
    this.db = db;
    this.projectId = projectId;
  }

  public createTask(params: {
    id?: string;
    title: string;
    description?: string;
    priority?: TaskPriority;
    assignedAgent?: string;
    status?: TaskStatus;
  }): TaskRecord {
    const id = params.id || `task_${crypto.randomBytes(6).toString("hex")}`;
    const now = new Date().toISOString();
    const status = params.status || "BACKLOG";
    const priority = params.priority || "MEDIUM";

    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id, project_id, title, description, status, priority, assigned_agent, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      this.projectId,
      params.title,
      params.description || null,
      status,
      priority,
      params.assignedAgent || null,
      now,
      now,
      status === "COMPLETED" ? now : null
    );

    return this.getTask(id)!;
  }

  public getTask(id: string): TaskRecord | null {
    const stmt = this.db.prepare("SELECT * FROM tasks WHERE id = ?");
    const row = stmt.get(id) as unknown as TaskRecord | undefined;
    return row || null;
  }

  public updateTaskStatus(id: string, status: TaskStatus): TaskRecord {
    const existing = this.getTask(id);
    if (!existing) {
      throw new Error(`Task not found: ${id}`);
    }

    const now = new Date().toISOString();
    const completedAt = status === "COMPLETED" ? now : (existing.status === "COMPLETED" ? null : existing.completed_at);

    this.db.prepare(`
      UPDATE tasks
      SET status = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `).run(status, now, completedAt, id);

    return this.getTask(id)!;
  }

  public assignTask(id: string, agentId: string | null): TaskRecord {
    const existing = this.getTask(id);
    if (!existing) {
      throw new Error(`Task not found: ${id}`);
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE tasks
      SET assigned_agent = ?, updated_at = ?
      WHERE id = ?
    `).run(agentId, now, id);

    return this.getTask(id)!;
  }

  public updateTask(
    id: string,
    updates: {
      title?: string;
      description?: string;
      priority?: TaskPriority;
      assignedAgent?: string | null;
      status?: TaskStatus;
    }
  ): TaskRecord {
    const existing = this.getTask(id);
    if (!existing) {
      throw new Error(`Task not found: ${id}`);
    }

    const now = new Date().toISOString();
    const title = updates.title !== undefined ? updates.title : existing.title;
    const description = updates.description !== undefined ? updates.description : existing.description;
    const priority = updates.priority !== undefined ? updates.priority : existing.priority;
    const assignedAgent = updates.assignedAgent !== undefined ? updates.assignedAgent : existing.assigned_agent;
    const status = updates.status !== undefined ? updates.status : existing.status;
    const completedAt = status === "COMPLETED" ? (existing.completed_at || now) : null;

    this.db.prepare(`
      UPDATE tasks
      SET title = ?, description = ?, priority = ?, assigned_agent = ?, status = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `).run(title, description, priority, assignedAgent, status, now, completedAt, id);

    return this.getTask(id)!;
  }

  public deleteTask(id: string): boolean {
    const res = this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    return res.changes > 0;
  }

  public listTasks(filter: {
    status?: TaskStatus;
    assignedAgent?: string;
    priority?: TaskPriority;
  } = {}): TaskRecord[] {
    const conditions: string[] = ["project_id = ?"];
    const params: any[] = [this.projectId];

    if (filter.status) {
      conditions.push("status = ?");
      params.push(filter.status);
    }
    if (filter.assignedAgent) {
      conditions.push("assigned_agent = ?");
      params.push(filter.assignedAgent);
    }
    if (filter.priority) {
      conditions.push("priority = ?");
      params.push(filter.priority);
    }

    const sql = `SELECT * FROM tasks WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC`;
    return this.db.prepare(sql).all(...params) as unknown as TaskRecord[];
  }

  // --- Task Dependencies with Cycle Detection ---

  public addDependency(taskId: string, dependsOnTaskId: string): void {
    if (taskId === dependsOnTaskId) {
      throw new Error(`Self-dependency not allowed on task: ${taskId}`);
    }

    const task = this.getTask(taskId);
    const dep = this.getTask(dependsOnTaskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (!dep) throw new Error(`Dependency task not found: ${dependsOnTaskId}`);

    // Cycle check: verify if dependsOnTaskId already depends on taskId (directly or transitively)
    if (this.hasPath(dependsOnTaskId, taskId)) {
      throw new Error(`Cycle detected: Adding dependency from ${taskId} to ${dependsOnTaskId} would form a cycle.`);
    }

    this.db.prepare(`
      INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id)
      VALUES (?, ?)
    `).run(taskId, dependsOnTaskId);
  }

  public removeDependency(taskId: string, dependsOnTaskId: string): boolean {
    const res = this.db.prepare(`
      DELETE FROM task_dependencies
      WHERE task_id = ? AND depends_on_task_id = ?
    `).run(taskId, dependsOnTaskId);
    return res.changes > 0;
  }

  public getDependencies(taskId: string): string[] {
    const rows = this.db.prepare(`
      SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?
    `).all(taskId) as unknown as { depends_on_task_id: string }[];
    return rows.map(r => r.depends_on_task_id);
  }

  public getDependents(taskId: string): string[] {
    const rows = this.db.prepare(`
      SELECT task_id FROM task_dependencies WHERE depends_on_task_id = ?
    `).all(taskId) as unknown as { task_id: string }[];
    return rows.map(r => r.task_id);
  }

  private hasPath(startTaskId: string, targetTaskId: string): boolean {
    const visited = new Set<string>();
    const queue: string[] = [startTaskId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === targetTaskId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      const deps = this.getDependencies(current);
      for (const d of deps) {
        if (!visited.has(d)) queue.push(d);
      }
    }

    return false;
  }

  // --- Task Artifacts ---

  public addArtifact(params: {
    taskId: string;
    artifactType: string;
    pathOrUri: string;
    metadata?: Record<string, unknown>;
  }): TaskArtifactRecord {
    const id = `art_${crypto.randomBytes(6).toString("hex")}`;
    const now = new Date().toISOString();
    const cleanMeta = sanitizeMetadata(params.metadata || {});
    const metaJson = JSON.stringify(cleanMeta);

    this.db.prepare(`
      INSERT INTO task_artifacts (id, task_id, artifact_type, path_or_uri, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, params.taskId, params.artifactType, params.pathOrUri, metaJson, now);

    const stmt = this.db.prepare("SELECT * FROM task_artifacts WHERE id = ?");
    return stmt.get(id) as unknown as TaskArtifactRecord;
  }

  public getArtifacts(taskId: string): TaskArtifactRecord[] {
    return this.db.prepare(`
      SELECT * FROM task_artifacts WHERE task_id = ? ORDER BY created_at ASC
    `).all(taskId) as unknown as TaskArtifactRecord[];
  }

  // --- Session Handover Summary ---

  public generateHandoverSummary(taskId: string): string {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const deps = this.getDependencies(taskId).map(id => this.getTask(id)?.title || id);
    const dependents = this.getDependents(taskId).map(id => this.getTask(id)?.title || id);
    const artifacts = this.getArtifacts(taskId);

    const activities = this.db.prepare(`
      SELECT * FROM agent_activities WHERE task_id = ? ORDER BY created_at DESC LIMIT 5
    `).all(taskId) as unknown as { agent_id: string; action_type: string; created_at: string }[];

    const lines: string[] = [
      `# Task Handover: ${task.title} [${task.id}]`,
      `- **Status:** ${task.status}`,
      `- **Priority:** ${task.priority}`,
      `- **Assigned Agent:** ${task.assigned_agent || "Unassigned"}`,
      `- **Created At:** ${task.created_at}`,
      `- **Completed At:** ${task.completed_at || "Incomplete"}`,
      "",
      `### Description`,
      task.description || "*(No description provided)*",
      "",
      `### Dependencies & Blockers`,
      deps.length > 0 ? deps.map(d => `- Prerequisite: ${d}`).join("\n") : "- No prerequisites.",
      dependents.length > 0 ? dependents.map(d => `- Downstream Blocker: ${d}`).join("\n") : "- No downstream dependents.",
      "",
      `### Artifacts (${artifacts.length})`,
      artifacts.length > 0 ? artifacts.map(a => `- [${a.artifact_type}] ${a.path_or_uri}`).join("\n") : "- No artifacts registered.",
      "",
      `### Recent Activities`,
      activities.length > 0 ? activities.map(act => `- [${act.created_at}] Agent ${act.agent_id}: ${act.action_type}`).join("\n") : "- No activities logged."
    ];

    return lines.join("\n");
  }
}
