import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { sanitizeMetadata } from "../security/redactor.js";

export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  description: string;
  capabilities: string[];
  system_instructions: string;
}

export interface ResourceLockRecord {
  resource_uri: string;
  locked_by_agent: string;
  project_id: string;
  acquired_at: string;
  expires_at: string;
}

export interface AgentActivityRecord {
  id: string;
  project_id: string;
  task_id: string | null;
  agent_id: string;
  action_type: string;
  details_json: string;
  created_at: string;
}

export const BUILTIN_AGENT_PROFILES: AgentProfile[] = [
  {
    id: "coordinator",
    name: "Swarm Coordinator",
    role: "Orchestration & Workflow",
    description: "Oversees task delegation, dependency DAGs, and multi-agent sync.",
    capabilities: ["task_planning", "agent_assignment", "status_tracking"],
    system_instructions: "Break down tasks logically, respect dependency constraints, and maintain project memory accuracy."
  },
  {
    id: "backend-dev",
    name: "Backend Developer",
    role: "Core Logic & API Engineering",
    description: "Designs robust business logic, services, databases, and APIs.",
    capabilities: ["api_design", "database_queries", "backend_services"],
    system_instructions: "Write clean, minimal, maintainable backend code with strict input validation and zero boilerplate."
  },
  {
    id: "frontend-dev",
    name: "Frontend Developer",
    role: "UI/UX & Interactive Visualizations",
    description: "Builds responsive user interfaces, design systems, and 3D graphs.",
    capabilities: ["react_components", "ui_ux_design", "3d_visualization"],
    system_instructions: "Implement fluid, accessible, high-contrast user interfaces with instant feedback."
  },
  {
    id: "security-auditor",
    name: "Security Auditor",
    role: "Vulnerability & Integrity Review",
    description: "Scans for secrets, input sanitation, path traversal, and RBAC.",
    capabilities: ["threat_modeling", "static_analysis", "credential_audit"],
    system_instructions: "Never bypass security controls. Enforce zero-trust boundaries and sanitize all inputs."
  },
  {
    id: "test-engineer",
    name: "Test Engineer",
    role: "Quality Assurance & Verification",
    description: "Authors unit, integration, and regression tests ensuring zero bugs.",
    capabilities: ["unit_testing", "integration_testing", "test_automation"],
    system_instructions: "Write self-contained, reproducible, non-flaky assertions that prove functional correctness."
  },
  {
    id: "researcher",
    name: "Researcher & Analyst",
    role: "Literature & Documentation Analysis",
    description: "Conducts deep dives, architectural research, and benchmark analysis.",
    capabilities: ["codebase_survey", "doc_lookup", "technology_benchmarking"],
    system_instructions: "Synthesize factual findings concisely without speculation."
  },
  {
    id: "dba",
    name: "Database Administrator",
    role: "Data Modeling & Index Tuning",
    description: "Optimizes relational schemas, FTS indexes, and query performance.",
    capabilities: ["schema_design", "fts_indexing", "query_optimization"],
    system_instructions: "Ensure ACID compliance, transactional integrity, and optimal index coverage."
  },
  {
    id: "devops",
    name: "DevOps Engineer",
    role: "Packaging & Deployment",
    description: "Automates desktop packaging, installers, CI/CD, and environments.",
    capabilities: ["installer_packaging", "build_tooling", "environment_management"],
    system_instructions: "Deliver reproducible single-click installers and clean build pipelines."
  },
  {
    id: "architect",
    name: "System Architect",
    role: "High-Level Architecture & Standards",
    description: "Defines system boundaries, module contracts, and threat models.",
    capabilities: ["system_design", "interface_definition", "quality_attributes"],
    system_instructions: "Design decoupled, modular, easily testable components adhering to YAGNI."
  },
  {
    id: "documenter",
    name: "Technical Documenter",
    role: "Documentation & Memory Records",
    description: "Creates comprehensive phase reports, API specs, and handovers.",
    capabilities: ["report_generation", "api_documentation", "handover_notes"],
    system_instructions: "Document exact results, metrics, failure modes, and recovery steps concisely."
  }
];

export class AgentRegistry {
  private db: DatabaseSync;
  private customProfiles: Map<string, AgentProfile> = new Map();

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  // --- Profiles ---

  public getProfile(id: string): AgentProfile | null {
    if (this.customProfiles.has(id)) {
      return this.customProfiles.get(id)!;
    }
    const builtin = BUILTIN_AGENT_PROFILES.find(p => p.id === id);
    return builtin || null;
  }

  public listProfiles(): AgentProfile[] {
    const list = [...BUILTIN_AGENT_PROFILES];
    for (const p of this.customProfiles.values()) {
      list.push(p);
    }
    return list;
  }

  public registerCustomProfile(profile: AgentProfile): void {
    this.customProfiles.set(profile.id, profile);
  }

  // --- Resource Locking ---

  public acquireLock(
    resourceUri: string,
    agentId: string,
    projectId: string,
    ttlSeconds: number = 300
  ): boolean {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const nowIso = now.toISOString();

    const stmt = this.db.prepare("SELECT * FROM resource_locks WHERE resource_uri = ?");
    const existing = stmt.get(resourceUri) as unknown as ResourceLockRecord | undefined;

    if (existing) {
      const isExpired = new Date(existing.expires_at).getTime() <= now.getTime();
      const isSameAgent = existing.locked_by_agent === agentId;

      if (!isExpired && !isSameAgent) {
        // Active lock held by another agent
        return false;
      }

      // Overwrite expired or renew same agent
      this.db.prepare(`
        UPDATE resource_locks
        SET locked_by_agent = ?, project_id = ?, acquired_at = ?, expires_at = ?
        WHERE resource_uri = ?
      `).run(agentId, projectId, nowIso, expiresAt, resourceUri);

      return true;
    }

    // Insert new lock
    this.db.prepare(`
      INSERT INTO resource_locks (resource_uri, locked_by_agent, project_id, acquired_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(resourceUri, agentId, projectId, nowIso, expiresAt);

    return true;
  }

  public releaseLock(resourceUri: string, agentId: string): boolean {
    const res = this.db.prepare(`
      DELETE FROM resource_locks
      WHERE resource_uri = ? AND locked_by_agent = ?
    `).run(resourceUri, agentId);

    return res.changes > 0;
  }

  public renewLock(resourceUri: string, agentId: string, ttlSeconds: number = 300): boolean {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

    const res = this.db.prepare(`
      UPDATE resource_locks
      SET expires_at = ?
      WHERE resource_uri = ? AND locked_by_agent = ?
    `).run(expiresAt, resourceUri, agentId);

    return res.changes > 0;
  }

  public listLocks(projectId?: string): ResourceLockRecord[] {
    if (projectId) {
      return this.db.prepare(
        "SELECT * FROM resource_locks WHERE project_id = ?"
      ).all(projectId) as unknown as ResourceLockRecord[];
    }
    return this.db.prepare("SELECT * FROM resource_locks").all() as unknown as ResourceLockRecord[];
  }

  public cleanExpiredLocks(): number {
    const now = new Date().toISOString();
    const res = this.db.prepare("DELETE FROM resource_locks WHERE expires_at <= ?").run(now);
    return Number(res.changes);
  }

  // --- Agent Activity Logging ---

  public logActivity(params: {
    projectId: string;
    taskId?: string;
    agentId: string;
    actionType: string;
    details?: Record<string, unknown>;
  }): AgentActivityRecord {
    const id = `act_${crypto.randomBytes(6).toString("hex")}`;
    const now = new Date().toISOString();
    const cleanDetails = sanitizeMetadata(params.details || {});
    const detailsJson = JSON.stringify(cleanDetails);

    this.db.prepare(`
      INSERT INTO agent_activities (id, project_id, task_id, agent_id, action_type, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.projectId,
      params.taskId || null,
      params.agentId,
      params.actionType,
      detailsJson,
      now
    );

    const stmt = this.db.prepare("SELECT * FROM agent_activities WHERE id = ?");
    return stmt.get(id) as unknown as AgentActivityRecord;
  }

  public getRecentActivities(projectId: string, limit: number = 50): AgentActivityRecord[] {
    return this.db.prepare(`
      SELECT * FROM agent_activities
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(projectId, limit) as unknown as AgentActivityRecord[];
  }

  public getAgentActivities(agentId: string, limit: number = 50): AgentActivityRecord[] {
    return this.db.prepare(`
      SELECT * FROM agent_activities
      WHERE agent_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(agentId, limit) as unknown as AgentActivityRecord[];
  }
}
