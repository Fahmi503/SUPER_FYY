import { TaskManager, TaskRecord } from "../tasks/task_manager.js";
import { AgentRegistry, AgentProfile } from "./agent_registry.js";
import { ProjectMemory } from "../memory/project_memory.js";
import { TaskCapsuleManager } from "../tasks/task_capsule.js";

export type AgentPermission = "READ_ONLY" | "TASK_WORKER" | "COORDINATOR" | "ADMIN";

export interface AgentContextDeclaration {
  agentId: string;
  role: string;
  permission: AgentPermission;
  projectId: string;
  currentTaskId?: string;
}

export class SwarmCoordinator {
  private tasks: TaskManager;
  private agents: AgentRegistry;
  private memory: ProjectMemory;
  private capsules: TaskCapsuleManager;
  private agentPermissions: Map<string, AgentPermission> = new Map();
  public readonly projectId: string;

  constructor(memory: ProjectMemory) {
    this.memory = memory;
    this.projectId = memory.projectId;
    this.tasks = new TaskManager(memory.getRawDb(), this.projectId);
    this.agents = new AgentRegistry(memory.getRawDb());
    this.capsules = new TaskCapsuleManager(memory.getRawDb(), this.projectId);
  }

  public setAgentPermission(agentId: string, permission: AgentPermission): void {
    this.agentPermissions.set(agentId, permission);
  }

  public getAgentPermission(agentId: string): AgentPermission {
    return this.agentPermissions.get(agentId) || "TASK_WORKER";
  }

  public assertWritePermission(agentId: string, operation: string): void {
    const perm = this.getAgentPermission(agentId);
    if (perm === "READ_ONLY") {
      throw new Error(`Permission Denied: Agent '${agentId}' has READ_ONLY permission and cannot perform '${operation}'.`);
    }
  }

  /**
   * Automatically suggests or assigns the most suitable agent profile based on task title and keywords.
   */
  public suggestAgentForTask(title: string, description: string = ""): AgentProfile {
    const text = `${title} ${description}`.toLowerCase();

    if (/\b(security|authn|authz|authentication|vulnerability|rbac|crypto)\b/i.test(text)) {
      return this.agents.getProfile("security-auditor")!;
    }
    if (/\b(ui|ux|frontend|view|css|tailwind|react|html|design)\b/i.test(text)) {
      return this.agents.getProfile("frontend-dev")!;
    }
    if (/\b(database|sql|sqlite|postgres|table|index|migration|schema|query)\b/i.test(text)) {
      return this.agents.getProfile("dba")!;
    }
    if (/\b(test|tests|assertion|assert|qa|coverage|unit)\b/i.test(text)) {
      return this.agents.getProfile("test-engineer")!;
    }
    if (/\b(package|installer|nsis|docker|deploy|electron|build)\b/i.test(text)) {
      return this.agents.getProfile("devops")!;
    }
    if (/\b(architecture|architect|system|pattern|dag)\b/i.test(text)) {
      return this.agents.getProfile("architect")!;
    }
    if (/\b(report|documentation|docs|handover|readme)\b/i.test(text)) {
      return this.agents.getProfile("documenter")!;
    }
    if (/\b(research|survey|benchmark|analysis)\b/i.test(text)) {
      return this.agents.getProfile("researcher")!;
    }

    return this.agents.getProfile("backend-dev")!;
  }

  /**
   * Starts a task only if all prerequisite dependencies in DAG are COMPLETED.
   * If prerequisites are incomplete, marks task as BLOCKED and returns reasons.
   */
  public startTask(
    taskId: string,
    agentId: string,
    resourceUriToLock?: string,
    lockTtlSeconds: number = 300
  ): { success: boolean; task: TaskRecord; blockedBy?: string[]; lockAcquired?: boolean } {
    this.assertWritePermission(agentId, "START_TASK");
    const task = this.tasks.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const deps = this.tasks.getDependencies(taskId);
    const incompleteDeps: string[] = [];

    for (const depId of deps) {
      const depTask = this.tasks.getTask(depId);
      if (!depTask || depTask.status !== "COMPLETED") {
        incompleteDeps.push(depTask ? `${depTask.title} [${depId}]` : depId);
      }
    }

    if (incompleteDeps.length > 0) {
      const updated = this.tasks.updateTaskStatus(taskId, "BLOCKED");
      this.agents.logActivity({
        projectId: this.projectId,
        taskId,
        agentId,
        actionType: "TASK_BLOCKED",
        details: { blockedBy: incompleteDeps }
      });
      return { success: false, task: updated, blockedBy: incompleteDeps };
    }

    // Acquire lock if requested
    let lockAcquired = false;
    if (resourceUriToLock) {
      lockAcquired = this.agents.acquireLock(resourceUriToLock, agentId, this.projectId, lockTtlSeconds);
      if (!lockAcquired) {
        throw new Error(`Failed to acquire resource lock on: ${resourceUriToLock}`);
      }
    }

    this.tasks.assignTask(taskId, agentId);
    const updated = this.tasks.updateTaskStatus(taskId, "IN_PROGRESS");
    this.agents.logActivity({
      projectId: this.projectId,
      taskId,
      agentId,
      actionType: "TASK_STARTED",
      details: { resourceLocked: resourceUriToLock || null }
    });

    return { success: true, task: updated, lockAcquired };
  }

  /**
   * Completes a task, optionally releases associated resource lock, and unblocks downstream tasks.
   */
  public completeTask(
    taskId: string,
    agentId: string,
    resourceUriToRelease?: string
  ): { task: TaskRecord; unblockedTaskIds: string[] } {
    this.assertWritePermission(agentId, "COMPLETE_TASK");
    const task = this.tasks.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    if (resourceUriToRelease) {
      this.agents.releaseLock(resourceUriToRelease, agentId);
    }

    const updated = this.tasks.updateTaskStatus(taskId, "COMPLETED");
    this.agents.logActivity({
      projectId: this.projectId,
      taskId,
      agentId,
      actionType: "TASK_COMPLETED",
      details: { releasedLock: resourceUriToRelease || null }
    });

    // Check downstream tasks that might now be unblocked
    const downstreamIds = this.tasks.getDependents(taskId);
    const unblocked: string[] = [];

    for (const did of downstreamIds) {
      const dTask = this.tasks.getTask(did);
      if (dTask && dTask.status === "BLOCKED") {
        const dDeps = this.tasks.getDependencies(did);
        const allCompleted = dDeps.every(id => this.tasks.getTask(id)?.status === "COMPLETED");
        if (allCompleted) {
          this.tasks.updateTaskStatus(did, "TODO");
          unblocked.push(did);
          this.agents.logActivity({
            projectId: this.projectId,
            taskId: did,
            agentId: "coordinator",
            actionType: "TASK_UNBLOCKED",
            details: { resolvedBy: taskId }
          });
        }
      }
    }

    return { task: updated, unblockedTaskIds: unblocked };
  }
}
