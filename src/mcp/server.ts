import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";

import { ProjectRegistry } from "../core/registry/project_registry.js";
import { ProjectMemory, EntityType, RelationType } from "../core/memory/project_memory.js";
import { TaskManager, TaskPriority, TaskStatus } from "../core/tasks/task_manager.js";
import { AgentRegistry, BUILTIN_AGENT_PROFILES } from "../core/agents/agent_registry.js";
import { GraphEngine } from "../core/graph/graph_engine.js";
import { ContextGuard } from "../core/security/context_guard.js";
import { TaskCapsuleManager } from "../core/tasks/task_capsule.js";
import { DecisionLedger, DecisionStatus } from "../core/decisions/decision_ledger.js";
import { ProvenanceEngine, VerificationStatus } from "../core/memory/provenance_engine.js";
import { ContextBuilder } from "../core/memory/context_builder.js";
import { ProjectIndexingEngine } from "../core/indexing/indexing_engine.js";
import { SeedReconciler } from "../core/indexing/seed_reconciler.js";

interface ProjectContext {
  memory: ProjectMemory;
  tasks: TaskManager;
  agents: AgentRegistry;
  graph: GraphEngine;
  capsules: TaskCapsuleManager;
  decisions: DecisionLedger;
  provenance: ProvenanceEngine;
  contextBuilder: ContextBuilder;
}

export class SuperFyyMcpServer {
  private server: Server;
  private registry: ProjectRegistry;
  private guard: ContextGuard;
  private contexts: Map<string, ProjectContext> = new Map();

  constructor(customDataDir?: string) {
    this.registry = new ProjectRegistry(customDataDir);
    this.guard = new ContextGuard(this.registry);
    this.server = new Server(
      {
        name: "super-fyy-mcp",
        version: "1.0.0"
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        }
      }
    );

    this.registerResources();
    this.registerPrompts();
    this.registerTools();
  }

  private getContext(projectId: string): ProjectContext {
    const project = this.registry.getProject(projectId);
    if (!project) {
      throw new McpError(ErrorCode.InvalidRequest, `Project not registered: ${projectId}`);
    }

    if (this.contexts.has(project.id)) {
      this.registry.touchProjectAccess(project.id);
      return this.contexts.get(project.id)!;
    }

    const memory = new ProjectMemory(project.memory_db_path, project.id);
    const tasks = new TaskManager(memory.getRawDb(), project.id);
    const agents = new AgentRegistry(memory.getRawDb());
    const graph = new GraphEngine(memory);
    const capsules = new TaskCapsuleManager(memory.getRawDb(), project.id);
    const decisions = new DecisionLedger(memory.getRawDb(), project.id);
    const provenance = new ProvenanceEngine(memory.getRawDb(), project.id);
    const contextBuilder = new ContextBuilder(memory);

    const ctx: ProjectContext = {
      memory,
      tasks,
      agents,
      graph,
      capsules,
      decisions,
      provenance,
      contextBuilder
    };

    this.contexts.set(project.id, ctx);
    this.registry.touchProjectAccess(project.id);
    return ctx;
  }

  private registerResources(): void {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: "superfyy://agents/profiles",
          name: "Agent Role Profiles",
          description: "Pre-configured reusable agent role profiles for Antigravity swarms",
          mimeType: "application/json"
        },
        {
          uri: "superfyy://projects/list",
          name: "Registered Projects",
          description: "List of all active projects registered with Super Fyy",
          mimeType: "application/json"
        }
      ]
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      if (uri === "superfyy://agents/profiles") {
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(BUILTIN_AGENT_PROFILES, null, 2)
            }
          ]
        };
      }
      if (uri === "superfyy://projects/list") {
        const list = this.registry.listProjects(false);
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(list, null, 2)
            }
          ]
        };
      }
      throw new McpError(ErrorCode.InvalidRequest, `Resource not found: ${uri}`);
    });
  }

  private registerPrompts(): void {
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: [
        {
          name: "superfyy_handover_prompt",
          description: "Generates context and handover instructions for next agent session",
          arguments: [
            { name: "project_id", description: "Project ID", required: true },
            { name: "task_id", description: "Task ID", required: true }
          ]
        },
        {
          name: "superfyy_impact_review_prompt",
          description: "Generates prompt to inspect upstream/downstream impact before refactoring",
          arguments: [
            { name: "project_id", description: "Project ID", required: true },
            { name: "entity_id", description: "Entity ID", required: true }
          ]
        }
      ]
    }));

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const projectId = args?.project_id as string;
      if (!projectId) {
        throw new McpError(ErrorCode.InvalidParams, "project_id is required");
      }

      const ctx = this.getContext(projectId);

      if (name === "superfyy_handover_prompt") {
        const taskId = args?.task_id as string;
        if (!taskId) throw new McpError(ErrorCode.InvalidParams, "task_id is required");
        const summary = ctx.tasks.generateHandoverSummary(taskId);
        return {
          description: `Handover for task ${taskId}`,
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `You are taking over the following task in SUPER FYY:\n\n${summary}\n\nPlease review dependencies and continue execution.`
              }
            }
          ]
        };
      }

      if (name === "superfyy_impact_review_prompt") {
        const entityId = args?.entity_id as string;
        if (!entityId) throw new McpError(ErrorCode.InvalidParams, "entity_id is required");
        const impact = ctx.graph.getImpactAnalysis(entityId);
        const up = impact.upstream.map(u => `- [${u.entity_type}] ${u.name} (${u.file_path || "no path"})`).join("\n");
        const down = impact.downstream.map(d => `- [${d.entity_type}] ${d.name} (${d.file_path || "no path"})`).join("\n");

        return {
          description: `Impact Review for entity ${entityId}`,
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `CRITICAL IMPACT AUDIT for entity ${entityId}:\n\n` +
                      `### Upstream Dependents (Will be affected if this changes):\n${up || "None"}\n\n` +
                      `### Downstream Dependencies (Prerequisites):\n${down || "None"}\n\n` +
                      `Please audit these components before making breaking changes.`
              }
            }
          ]
        };
      }

      throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
    });
  }

  private registerTools(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // Project Management
        {
          name: "superfyy_register_project",
          description: "Register a local project directory into Super Fyy global registry",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Display name of project" },
              canonical_path: { type: "string", description: "Absolute path to project root" },
              technology: { type: "string", description: "Stack/tech (e.g. Python, Node.js)" }
            },
            required: ["name", "canonical_path"]
          }
        },
        {
          name: "superfyy_list_projects",
          description: "List all projects managed by Super Fyy",
          inputSchema: {
            type: "object",
            properties: {
              include_archived: { type: "boolean", description: "Include archived projects" }
            }
          }
        },
        {
          name: "superfyy_get_project",
          description: "Get project details by project_id or canonical path",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              canonical_path: { type: "string", description: "Canonical folder path" }
            }
          }
        },
        {
          name: "superfyy_validate_project_scope",
          description: "Context Guard: Validates that a project exists and subpath is strictly within bounds",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              requested_path: { type: "string" }
            },
            required: ["project_id"]
          }
        },

        // Memory & Knowledge Graph
        {
          name: "superfyy_add_entity",
          description: "Add a node (File, Class, Function, Table, Decision, etc.) to project memory graph",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              entity_type: {
                type: "string",
                enum: [
                  "FILE", "FOLDER", "FUNCTION", "CLASS", "MODULE", "TASK",
                  "ISSUE", "DECISION", "DOCUMENT", "TEST", "AGENT", "COMMUNITY",
                  "GIT_COMMIT", "API_ENDPOINT", "DATABASE_TABLE"
                ]
              },
              name: { type: "string", description: "Name of the entity" },
              file_path: { type: "string", description: "Relative or absolute file path" },
              summary: { type: "string", description: "Short description" },
              full_content: { type: "string", description: "Detailed content/code" },
              metadata: { type: "object", description: "Additional key-value metadata" }
            },
            required: ["project_id", "entity_type", "name"]
          }
        },
        {
          name: "superfyy_update_entity",
          description: "Update an existing node in project memory",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project ID" },
              entity_id: { type: "string", description: "Node ID to update" },
              name: { type: "string" },
              file_path: { type: "string" },
              summary: { type: "string" },
              full_content: { type: "string" },
              metadata: { type: "object" }
            },
            required: ["project_id", "entity_id"]
          }
        },
        {
          name: "superfyy_get_entity",
          description: "Retrieve entity details from memory by entity_id",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              entity_id: { type: "string" }
            },
            required: ["project_id", "entity_id"]
          }
        },
        {
          name: "superfyy_query_entities",
          description: "Query entities filtered by type or file path",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              entity_type: { type: "string" },
              file_path: { type: "string" },
              limit: { type: "number" }
            },
            required: ["project_id"]
          }
        },
        {
          name: "superfyy_search_memory",
          description: "Execute FTS5 full-text keyword search across project memory graph",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              query: { type: "string", description: "Search query" },
              limit: { type: "number" }
            },
            required: ["project_id", "query"]
          }
        },
        {
          name: "superfyy_connect_entities",
          description: "Create a relation edge between two entities in project graph",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              source_id: { type: "string" },
              target_id: { type: "string" },
              relation_type: {
                type: "string",
                enum: [
                  "IMPORTS", "CALLS", "DEFINES", "IMPLEMENTS", "DEPENDS_ON",
                  "TESTED_BY", "RESOLVES", "DECIDED_BY", "MODIFIES", "PART_OF",
                  "ASSIGNED_TO", "PRODUCED"
                ]
              },
              weight: { type: "number" },
              metadata: { type: "object" }
            },
            required: ["project_id", "source_id", "target_id", "relation_type"]
          }
        },
        {
          name: "superfyy_get_subgraph",
          description: "Fetch connected subgraph of nodes and edges for visualization or context",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              limit: { type: "number" }
            },
            required: ["project_id"]
          }
        },
        {
          name: "superfyy_impact_analysis",
          description: "Calculate upstream and downstream blast radius for an entity before refactoring",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              entity_id: { type: "string" },
              max_depth: { type: "number" }
            },
            required: ["project_id", "entity_id"]
          }
        },
        {
          name: "superfyy_find_path",
          description: "Find shortest relationship path between two entities in project memory",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              source_id: { type: "string" },
              target_id: { type: "string" }
            },
            required: ["project_id", "source_id", "target_id"]
          }
        },

        // Task Management & Capsules
        {
          name: "superfyy_create_task",
          description: "Create a work item / task with status and priority",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              title: { type: "string" },
              description: { type: "string" },
              priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
              assigned_agent: { type: "string" }
            },
            required: ["project_id", "title"]
          }
        },
        {
          name: "superfyy_update_task_status",
          description: "Update task lifecycle status (BACKLOG -> COMPLETED)",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              task_id: { type: "string" },
              status: {
                type: "string",
                enum: ["BACKLOG", "TODO", "IN_PROGRESS", "BLOCKED", "REVIEW", "COMPLETED", "CANCELLED"]
              }
            },
            required: ["project_id", "task_id", "status"]
          }
        },
        {
          name: "superfyy_list_tasks",
          description: "List project tasks with optional status and agent filters",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              status: { type: "string" },
              assigned_agent: { type: "string" }
            },
            required: ["project_id"]
          }
        },
        {
          name: "superfyy_add_task_dependency",
          description: "Add a DAG dependency between tasks with cycle detection",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              task_id: { type: "string", description: "Dependent task" },
              depends_on_task_id: { type: "string", description: "Prerequisite task" }
            },
            required: ["project_id", "task_id", "depends_on_task_id"]
          }
        },
        {
          name: "superfyy_add_task_artifact",
          description: "Register a generated artifact (file, report, DB backup) to a task",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              task_id: { type: "string" },
              artifact_type: { type: "string" },
              path_or_uri: { type: "string" },
              metadata: { type: "object" }
            },
            required: ["project_id", "task_id", "artifact_type", "path_or_uri"]
          }
        },
        {
          name: "superfyy_get_task_handover",
          description: "Generate structured handover summary for session transfer",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              task_id: { type: "string" }
            },
            required: ["project_id", "task_id"]
          }
        },
        {
          name: "superfyy_create_task_capsule",
          description: "M10: Define a structured task capsule with in-scope, out-of-scope, and constraints",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              task_id: { type: "string" },
              task_name: { type: "string" },
              user_request: { type: "string" },
              objective: { type: "string" },
              in_scope_paths: { type: "array", items: { type: "string" } },
              out_of_scope_paths: { type: "array", items: { type: "string" } },
              constraints: { type: "array", items: { type: "string" } },
              acceptance_criteria: { type: "array", items: { type: "string" } },
              owner_agent: { type: "string" }
            },
            required: ["project_id", "task_id", "task_name", "user_request", "objective"]
          }
        },
        {
          name: "superfyy_get_task_capsule",
          description: "M10: Retrieve structured context capsule for a task",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              task_id: { type: "string" }
            },
            required: ["project_id", "task_id"]
          }
        },
        {
          name: "superfyy_verify_action_scope",
          description: "M10 Anti-Drift Guard: Verify if planned operation/file is within authorized task scope",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              task_id: { type: "string" },
              target_path: { type: "string" },
              operation: { type: "string" },
              description: { type: "string" }
            },
            required: ["project_id", "task_id"]
          }
        },

        // Provenance & Evidence
        {
          name: "superfyy_record_evidence",
          description: "M10: Record verifiable evidence with source file hash, line range, and test link",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              statement: { type: "string" },
              source_type: { type: "string", enum: ["FILE", "TEST", "GIT_COMMIT", "REPORT", "INSPECTION"] },
              source_path: { type: "string" },
              line_range: { type: "string" },
              agent_id: { type: "string" },
              task_id: { type: "string" },
              test_name: { type: "string" },
              report_ref: { type: "string" }
            },
            required: ["project_id", "statement", "source_type", "source_path", "agent_id"]
          }
        },
        {
          name: "superfyy_check_freshness",
          description: "M10: Check if source file changed on disk and mark related memory STALE if modified",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              relative_path: { type: "string" }
            },
            required: ["project_id", "relative_path"]
          }
        },

        // Decision Ledger
        {
          name: "superfyy_record_decision",
          description: "M10: Record a project architectural or policy decision",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              title: { type: "string" },
              context: { type: "string" },
              decision: { type: "string" },
              reason: { type: "string" },
              consequences: { type: "string" },
              created_by: { type: "string" },
              approved_by: { type: "string" },
              task_id: { type: "string" }
            },
            required: ["project_id", "title", "context", "decision", "reason", "created_by"]
          }
        },
        {
          name: "superfyy_accept_decision",
          description: "M10: Formally accept/approve a recorded decision",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              decision_id: { type: "string" },
              approved_by: { type: "string" }
            },
            required: ["project_id", "decision_id", "approved_by"]
          }
        },
        {
          name: "superfyy_supersede_decision",
          description: "M10: Replace an old decision with a new accepted decision preserving history",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              old_decision_id: { type: "string" },
              new_decision: { type: "object" }
            },
            required: ["project_id", "old_decision_id", "new_decision"]
          }
        },
        {
          name: "superfyy_list_decisions",
          description: "M10: List project decisions with status filter",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              status: { type: "string", enum: ["PROPOSED", "ACCEPTED", "REJECTED", "SUPERSEDED", "DEPRECATED"] }
            },
            required: ["project_id"]
          }
        },
        {
          name: "superfyy_detect_contradictions",
          description: "M10: Detect contradictions between proposed instruction/code and accepted decisions",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              statement: { type: "string" }
            },
            required: ["project_id", "statement"]
          }
        },

        // Context Package Builder & Explainability
        {
          name: "superfyy_build_context_package",
          description: "M10: Build compact, prioritized, evidence-backed context package for an AI agent",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              user_instruction: { type: "string" },
              task_id: { type: "string" }
            },
            required: ["project_id", "user_instruction"]
          }
        },
        {
          name: "superfyy_inspect_context_package",
          description: "M10: Explain why each context piece was selected (Why This Context?)",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              user_instruction: { type: "string" },
              task_id: { type: "string" }
            },
            required: ["project_id", "user_instruction"]
          }
        },

        // Agent Coordination & Resource Locks
        {
          name: "superfyy_acquire_lock",
          description: "Acquire soft lock on a file/resource to prevent concurrent agent conflicts",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              resource_uri: { type: "string" },
              agent_id: { type: "string" },
              ttl_seconds: { type: "number", description: "TTL in seconds (default: 300)" }
            },
            required: ["project_id", "resource_uri", "agent_id"]
          }
        },
        {
          name: "superfyy_release_lock",
          description: "Release lock on a resource",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              resource_uri: { type: "string" },
              agent_id: { type: "string" }
            },
            required: ["project_id", "resource_uri", "agent_id"]
          }
        },
        {
          name: "superfyy_list_locks",
          description: "List active resource locks",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" }
            }
          }
        },
        {
          name: "superfyy_log_activity",
          description: "Log agent action for audit trail and coordination",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              agent_id: { type: "string" },
              action_type: { type: "string" },
              task_id: { type: "string" },
              details: { type: "object" }
            },
            required: ["project_id", "agent_id", "action_type"]
          }
        },
        {
          name: "superfyy_get_activities",
          description: "Get recent agent activities in project",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              limit: { type: "number" }
            },
            required: ["project_id"]
          }
        },

        // Repository Deep Indexing
        {
          name: "superfyy_index_project",
          description: "Perform deep structural indexing (folders, files, AST classes/functions, SQL schemas, tests, docs) on a registered project",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              max_file_size_kb: { type: "number" }
            },
            required: ["project_id"]
          }
        },
        {
          name: "superfyy_get_indexing_status",
          description: "Get repository indexing status, total files, and entity category counts",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" }
            },
            required: ["project_id"]
          }
        },
        {
          name: "superfyy_reconcile_legacy_seed",
          description: "Reconcile legacy seed nodes with verified repository entities preserving history",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" }
            },
            required: ["project_id"]
          }
        },

        // 3D Visualization
        {
          name: "superfyy_get_spherical_graph",
          description: "Get 3D spherical force-directed graph JSON data for 3D visualization",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string" },
              sphere_radius: { type: "number" },
              limit: { type: "number" }
            },
            required: ["project_id"]
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const a = args || {};

      try {
        switch (name) {
          // Projects & Context Guard
          case "superfyy_register_project": {
            const res = this.registry.registerProject({
              name: a.name as string,
              canonicalPath: a.canonical_path as string,
              technology: a.technology as string | undefined
            });
            return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
          }
          case "superfyy_list_projects": {
            const res = this.registry.listProjects(Boolean(a.include_archived));
            return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
          }
          case "superfyy_get_project": {
            let res = null;
            if (a.project_id) {
              res = this.registry.getProject(a.project_id as string);
            } else if (a.canonical_path) {
              res = this.registry.getProjectByPath(a.canonical_path as string);
            }
            return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
          }
          case "superfyy_validate_project_scope": {
            const res = this.guard.validateProjectScope(a.project_id as string, a.requested_path as string | undefined);
            return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
          }

          // Entity Graph & Memory
          case "superfyy_add_entity": {
            const ctx = this.getContext(a.project_id as string);
            const node = ctx.memory.addNode({
              entityType: a.entity_type as EntityType,
              name: a.name as string,
              filePath: a.file_path as string | undefined,
              summary: a.summary as string | undefined,
              fullContent: a.full_content as string | undefined,
              metadata: a.metadata as Record<string, unknown> | undefined
            });
            return { content: [{ type: "text", text: JSON.stringify(node, null, 2) }] };
          }
          case "superfyy_update_entity": {
            const ctx = this.getContext(a.project_id as string);
            const node = ctx.memory.updateNode(a.entity_id as string, {
              name: a.name as string | undefined,
              filePath: a.file_path as string | undefined,
              summary: a.summary as string | undefined,
              fullContent: a.full_content as string | undefined,
              metadata: a.metadata as Record<string, unknown> | undefined
            });
            return { content: [{ type: "text", text: JSON.stringify(node, null, 2) }] };
          }
          case "superfyy_get_entity": {
            const ctx = this.getContext(a.project_id as string);
            const node = ctx.memory.getNode(a.entity_id as string);
            return { content: [{ type: "text", text: JSON.stringify(node, null, 2) }] };
          }
          case "superfyy_query_entities": {
            const ctx = this.getContext(a.project_id as string);
            const nodes = ctx.memory.queryNodes({
              entityType: a.entity_type as EntityType | undefined,
              filePath: a.file_path as string | undefined,
              limit: a.limit as number | undefined
            });
            return { content: [{ type: "text", text: JSON.stringify(nodes, null, 2) }] };
          }
          case "superfyy_search_memory": {
            const ctx = this.getContext(a.project_id as string);
            const nodes = ctx.memory.searchFts(a.query as string, (a.limit as number) || 20);
            return { content: [{ type: "text", text: JSON.stringify(nodes, null, 2) }] };
          }
          case "superfyy_connect_entities": {
            const ctx = this.getContext(a.project_id as string);
            const edge = ctx.memory.addEdge({
              sourceId: a.source_id as string,
              targetId: a.target_id as string,
              relationType: a.relation_type as RelationType,
              weight: a.weight as number | undefined,
              metadata: a.metadata as Record<string, unknown> | undefined
            });
            return { content: [{ type: "text", text: JSON.stringify(edge, null, 2) }] };
          }
          case "superfyy_get_subgraph": {
            const ctx = this.getContext(a.project_id as string);
            const graph = ctx.memory.getGraph({
              limit: a.limit as number | undefined
            });
            return { content: [{ type: "text", text: JSON.stringify(graph, null, 2) }] };
          }
          case "superfyy_impact_analysis": {
            const ctx = this.getContext(a.project_id as string);
            const impact = ctx.graph.getImpactAnalysis(
              a.entity_id as string,
              a.max_depth as number | undefined
            );
            return { content: [{ type: "text", text: JSON.stringify(impact, null, 2) }] };
          }
          case "superfyy_find_path": {
            const ctx = this.getContext(a.project_id as string);
            const path = ctx.graph.findShortestPath(a.source_id as string, a.target_id as string);
            return { content: [{ type: "text", text: JSON.stringify({ path }, null, 2) }] };
          }

          // Tasks & Context Capsules
          case "superfyy_create_task": {
            const ctx = this.getContext(a.project_id as string);
            const task = ctx.tasks.createTask({
              title: a.title as string,
              description: a.description as string | undefined,
              priority: a.priority as TaskPriority | undefined,
              assignedAgent: a.assigned_agent as string | undefined
            });
            return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
          }
          case "superfyy_update_task_status": {
            const ctx = this.getContext(a.project_id as string);
            const task = ctx.tasks.updateTaskStatus(
              a.task_id as string,
              a.status as TaskStatus
            );
            return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
          }
          case "superfyy_list_tasks": {
            const ctx = this.getContext(a.project_id as string);
            const tasks = ctx.tasks.listTasks({
              status: a.status as TaskStatus | undefined,
              assignedAgent: a.assigned_agent as string | undefined
            });
            return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
          }
          case "superfyy_add_task_dependency": {
            const ctx = this.getContext(a.project_id as string);
            ctx.tasks.addDependency(a.task_id as string, a.depends_on_task_id as string);
            return { content: [{ type: "text", text: JSON.stringify({ success: true }) }] };
          }
          case "superfyy_add_task_artifact": {
            const ctx = this.getContext(a.project_id as string);
            const art = ctx.tasks.addArtifact({
              taskId: a.task_id as string,
              artifactType: a.artifact_type as string,
              pathOrUri: a.path_or_uri as string,
              metadata: a.metadata as Record<string, unknown> | undefined
            });
            return { content: [{ type: "text", text: JSON.stringify(art, null, 2) }] };
          }
          case "superfyy_get_task_handover": {
            const ctx = this.getContext(a.project_id as string);
            const handover = ctx.tasks.generateHandoverSummary(a.task_id as string);
            return { content: [{ type: "text", text: handover }] };
          }
          case "superfyy_create_task_capsule": {
            const ctx = this.getContext(a.project_id as string);
            const capsule = ctx.capsules.createCapsule({
              taskId: a.task_id as string,
              projectId: a.project_id as string,
              taskName: a.task_name as string,
              userRequest: a.user_request as string,
              objective: a.objective as string,
              inScopePaths: a.in_scope_paths as string[] | undefined,
              outOfScopePaths: a.out_of_scope_paths as string[] | undefined,
              constraints: a.constraints as string[] | undefined,
              acceptanceCriteria: a.acceptance_criteria as string[] | undefined,
              ownerAgent: a.owner_agent as string | undefined
            });
            return { content: [{ type: "text", text: JSON.stringify(capsule, null, 2) }] };
          }
          case "superfyy_get_task_capsule": {
            const ctx = this.getContext(a.project_id as string);
            const capsule = ctx.capsules.getCapsule(a.task_id as string);
            return { content: [{ type: "text", text: JSON.stringify(capsule, null, 2) }] };
          }
          case "superfyy_verify_action_scope": {
            const ctx = this.getContext(a.project_id as string);
            const contract = ctx.capsules.generateExecutionContract(a.task_id as string);
            const check = this.guard.verifyActionAgainstContract(contract, {
              targetPath: a.target_path as string | undefined,
              operation: a.operation as string | undefined,
              description: a.description as string | undefined
            });
            return { content: [{ type: "text", text: JSON.stringify(check, null, 2) }] };
          }

          // Provenance & Evidence
          case "superfyy_record_evidence": {
            const ctx = this.getContext(a.project_id as string);
            const project = this.registry.getProject(a.project_id as string)!;
            const fullPath = a.source_path ? (a.source_path as string).replace(/\\/g, "/") : "";
            const computedHash = ctx.provenance.computeFileHash(
              `${project.canonical_path}/${fullPath}`
            );

            const evi = ctx.provenance.recordEvidence({
              statement: a.statement as string,
              sourceType: a.source_type as any,
              sourcePath: fullPath,
              lineRange: a.line_range as string | undefined,
              fileHash: (a.file_hash as string) || computedHash || undefined,
              testName: a.test_name as string | undefined,
              reportRef: a.report_ref as string | undefined,
              agentId: a.agent_id as string,
              taskId: a.task_id as string | undefined
            });
            return { content: [{ type: "text", text: JSON.stringify(evi, null, 2) }] };
          }
          case "superfyy_check_freshness": {
            const ctx = this.getContext(a.project_id as string);
            const project = this.registry.getProject(a.project_id as string)!;
            const res = ctx.provenance.verifyFreshness(project.canonical_path, a.relative_path as string);
            return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
          }

          // Decision Ledger
          case "superfyy_record_decision": {
            const ctx = this.getContext(a.project_id as string);
            const dec = ctx.decisions.recordDecision({
              title: a.title as string,
              context: a.context as string,
              decision: a.decision as string,
              reason: a.reason as string,
              consequences: a.consequences as string | undefined,
              createdBy: a.created_by as string,
              approvedBy: a.approved_by as string | undefined,
              taskId: a.task_id as string | undefined
            });
            return { content: [{ type: "text", text: JSON.stringify(dec, null, 2) }] };
          }
          case "superfyy_accept_decision": {
            const ctx = this.getContext(a.project_id as string);
            const dec = ctx.decisions.acceptDecision(a.decision_id as string, a.approved_by as string);
            return { content: [{ type: "text", text: JSON.stringify(dec, null, 2) }] };
          }
          case "superfyy_supersede_decision": {
            const ctx = this.getContext(a.project_id as string);
            const res = ctx.decisions.supersedeDecision(a.old_decision_id as string, a.new_decision as any);
            return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
          }
          case "superfyy_list_decisions": {
            const ctx = this.getContext(a.project_id as string);
            const decs = ctx.decisions.listDecisions({ status: a.status as DecisionStatus | undefined });
            return { content: [{ type: "text", text: JSON.stringify(decs, null, 2) }] };
          }
          case "superfyy_detect_contradictions": {
            const ctx = this.getContext(a.project_id as string);
            const conflicts = ctx.decisions.detectContradictions(a.statement as string);
            return { content: [{ type: "text", text: JSON.stringify(conflicts, null, 2) }] };
          }

          // Context Package Builder & Explainability
          case "superfyy_build_context_package": {
            const ctx = this.getContext(a.project_id as string);
            const pkg = ctx.contextBuilder.buildContextPackage({
              userInstruction: a.user_instruction as string,
              taskId: a.task_id as string | undefined
            });
            return { content: [{ type: "text", text: JSON.stringify(pkg, null, 2) }] };
          }
          case "superfyy_inspect_context_package": {
            const ctx = this.getContext(a.project_id as string);
            const pkg = ctx.contextBuilder.buildContextPackage({
              userInstruction: a.user_instruction as string,
              taskId: a.task_id as string | undefined
            });
            const explain = ctx.contextBuilder.explainContext(pkg);
            return { content: [{ type: "text", text: explain }] };
          }

          // Resource Locks & Activities
          case "superfyy_acquire_lock": {
            const ctx = this.getContext(a.project_id as string);
            const success = ctx.agents.acquireLock(
              a.resource_uri as string,
              a.agent_id as string,
              a.project_id as string,
              a.ttl_seconds as number | undefined
            );
            return { content: [{ type: "text", text: JSON.stringify({ success }) }] };
          }
          case "superfyy_release_lock": {
            const ctx = this.getContext(a.project_id as string);
            const success = ctx.agents.releaseLock(
              a.resource_uri as string,
              a.agent_id as string
            );
            return { content: [{ type: "text", text: JSON.stringify({ success }) }] };
          }
          case "superfyy_list_locks": {
            let locks: any[] = [];
            if (a.project_id) {
              const ctx = this.getContext(a.project_id as string);
              locks = ctx.agents.listLocks(a.project_id as string);
            }
            return { content: [{ type: "text", text: JSON.stringify(locks, null, 2) }] };
          }
          case "superfyy_log_activity": {
            const ctx = this.getContext(a.project_id as string);
            const act = ctx.agents.logActivity({
              projectId: a.project_id as string,
              agentId: a.agent_id as string,
              actionType: a.action_type as string,
              taskId: a.task_id as string | undefined,
              details: a.details as Record<string, unknown> | undefined
            });
            return { content: [{ type: "text", text: JSON.stringify(act, null, 2) }] };
          }
          case "superfyy_get_activities": {
            const ctx = this.getContext(a.project_id as string);
            const acts = ctx.agents.getRecentActivities(
              a.project_id as string,
              a.limit as number | undefined
            );
            return { content: [{ type: "text", text: JSON.stringify(acts, null, 2) }] };
          }

          // Repository Deep Indexing
          case "superfyy_index_project": {
            const project = this.registry.getProject(a.project_id as string);
            if (!project) throw new Error(`Project not found: ${a.project_id}`);
            const ctx = this.getContext(project.id);
            const indexer = new ProjectIndexingEngine(ctx.memory, {
              projectId: project.id,
              projectRoot: project.canonical_path,
              maxFileSizeBytes: a.max_file_size_kb ? Number(a.max_file_size_kb) * 1024 : undefined
            });
            const summary = await indexer.indexProject();
            return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
          }
          case "superfyy_get_indexing_status": {
            const project = this.registry.getProject(a.project_id as string);
            if (!project) throw new Error(`Project not found: ${a.project_id}`);
            const ctx = this.getContext(project.id);
            const files = ctx.memory.listIndexedFiles();
            const graph = ctx.memory.getGraph({ limit: 10000 });
            const counts: Record<string, number> = {};
            for (const n of graph.nodes) counts[n.entity_type] = (counts[n.entity_type] || 0) + 1;
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  projectId: project.id,
                  totalIndexedFiles: files.length,
                  totalNodes: graph.nodes.length,
                  totalEdges: graph.edges.length,
                  entityCounts: counts
                }, null, 2)
              }]
            };
          }
          case "superfyy_reconcile_legacy_seed": {
            const project = this.registry.getProject(a.project_id as string);
            if (!project) throw new Error(`Project not found: ${a.project_id}`);
            const ctx = this.getContext(project.id);
            const reconciler = new SeedReconciler(ctx.memory);
            const report = reconciler.reconcileLegacySeed([]);
            return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
          }

          // 3D Visualization
          case "superfyy_get_spherical_graph": {
            const ctx = this.getContext(a.project_id as string);
            const graphData = ctx.graph.exportSphericalGraph({
              sphereRadius: a.sphere_radius as number | undefined,
              limit: a.limit as number | undefined
            });
            return { content: [{ type: "text", text: JSON.stringify(graphData, null, 2) }] };
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${err.message || String(err)}` }]
        };
      }
    });
  }

  public async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Super Fyy MCP Server running on stdio");
  }

  public getServer(): Server {
    return this.server;
  }
}

// Standalone execution entrypoint
if (process.argv[1]?.endsWith("server.js") || process.argv[1]?.endsWith("server.ts")) {
  const mcpServer = new SuperFyyMcpServer();
  mcpServer.start().catch((err) => {
    console.error("MCP Server startup failed:", err);
    process.exit(1);
  });
}
