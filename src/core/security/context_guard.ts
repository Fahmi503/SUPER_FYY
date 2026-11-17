import path from "node:path";
import fs from "node:fs";
import { ProjectRegistry, ProjectRecord } from "../registry/project_registry.js";
import { PathGuard } from "./path_guard.js";

export interface ExecutionContract {
  taskId: string;
  projectId: string;
  taskName: string;
  inScopePaths: string[];
  outOfScopePaths: string[];
  forbiddenOperations: string[];
  requiredDecisions: string[];
}

export interface ScopeCheckResult {
  allowed: boolean;
  violationType?: "SCOPE_VIOLATION" | "OPERATION_FORBIDDEN" | "PROJECT_MISMATCH" | "PATH_TRAVERSAL";
  reason?: string;
}

export class ContextGuard {
  private registry: ProjectRegistry;
  private activeSessionBindings: Map<string, { projectId: string; activeTaskId?: string }> = new Map();

  constructor(registry: ProjectRegistry) {
    this.registry = registry;
  }

  /**
   * Binds a session token or IDE window ID to a verified project and task scope.
   */
  public bindSession(sessionId: string, projectId: string, activeTaskId?: string): void {
    const project = this.registry.getProject(projectId);
    if (!project) {
      throw new Error(`Cannot bind session: Project '${projectId}' not found in registry.`);
    }
    this.activeSessionBindings.set(sessionId, { projectId: project.id, activeTaskId });
  }

  public getSessionBinding(sessionId: string): { projectId: string; activeTaskId?: string } | null {
    return this.activeSessionBindings.get(sessionId) || null;
  }

  /**
   * Validates that a project exists, resolves its canonical path, and verifies an optional target path.
   */
  public validateProjectScope(projectId: string, requestedSubpath?: string): { project: ProjectRecord; canonicalTarget?: string } {
    if (!projectId || typeof projectId !== "string" || !projectId.trim()) {
      throw new Error("Project Scope Violation: project_id is missing or invalid.");
    }

    const project = this.registry.getProject(projectId.trim());
    if (!project) {
      throw new Error(`Project Scope Violation: Project '${projectId}' is not registered in Super Fyy.`);
    }

    if (!fs.existsSync(project.canonical_path)) {
      throw new Error(`Project Scope Violation: Canonical directory for '${project.name}' no longer exists on disk: ${project.canonical_path}`);
    }

    let canonicalTarget: string | undefined;
    if (requestedSubpath) {
      canonicalTarget = PathGuard.validateSafeSubpath(project.canonical_path, requestedSubpath);
    }

    return { project, canonicalTarget };
  }

  /**
   * Evaluates planned action against the task Execution Contract to prevent scope drift.
   */
  public verifyActionAgainstContract(
    contract: ExecutionContract,
    action: { targetPath?: string; operation?: string; description?: string }
  ): ScopeCheckResult {
    const { targetPath, operation, description } = action;

    // Check forbidden operations (e.g., "ALTER_PAYROLL_FORMULA", "MODIFY_DATABASE_SCHEMA" during UI task)
    if (operation) {
      const opNorm = operation.toUpperCase();
      for (const forbidden of contract.forbiddenOperations) {
        if (opNorm.includes(forbidden.toUpperCase())) {
          return {
            allowed: false,
            violationType: "OPERATION_FORBIDDEN",
            reason: `Operation '${operation}' is explicitly prohibited by contract for task ${contract.taskId}: ${forbidden}`
          };
        }
      }
    }

    // Check path constraints
    if (targetPath) {
      const normalizedTarget = targetPath.replace(/\\/g, "/").toLowerCase();

      // Explicit out-of-scope check
      for (const outPath of contract.outOfScopePaths) {
        const normOut = outPath.replace(/\\/g, "/").toLowerCase();
        if (normalizedTarget.includes(normOut)) {
          return {
            allowed: false,
            violationType: "SCOPE_VIOLATION",
            reason: `Path '${targetPath}' is explicitly OUT OF SCOPE for task ${contract.taskId} (${contract.taskName}).`
          };
        }
      }

      // If in-scope paths are defined, target must match at least one in-scope prefix
      if (contract.inScopePaths.length > 0) {
        const matchesInScope = contract.inScopePaths.some(inPath => {
          const normIn = inPath.replace(/\\/g, "/").toLowerCase();
          return normalizedTarget.includes(normIn);
        });

        if (!matchesInScope) {
          return {
            allowed: false,
            violationType: "SCOPE_VIOLATION",
            reason: `Path '${targetPath}' is outside the authorized scope for task ${contract.taskId}. Allowed: [${contract.inScopePaths.join(", ")}]`
          };
        }
      }
    }

    return { allowed: true };
  }
}
