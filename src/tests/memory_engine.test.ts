import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { ProjectRegistry } from "../core/registry/project_registry.js";
import { ProjectMemory } from "../core/memory/project_memory.js";
import { TaskManager } from "../core/tasks/task_manager.js";
import { AgentRegistry } from "../core/agents/agent_registry.js";
import { sanitizeMetadata } from "../core/security/redactor.js";
import { validateSafeSubpath, isExcluded } from "../core/security/path_guard.js";

test("SUPER FYY Phase P2 — Core Memory Engine Test Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "superfyy_p2_test_"));

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test("Security: path guard & redactor", () => {
    // Path guard validation
    const sub = path.join(tmpDir, "sub");
    fs.mkdirSync(sub, { recursive: true });
    const validated = validateSafeSubpath(tmpDir, "sub");
    assert.equal(validated, sub);

    // Exclusion filter
    assert.equal(isExcluded(".env"), true);
    assert.equal(isExcluded("node_modules/foo/bar.js"), true);
    assert.equal(isExcluded("src/main.ts"), false);

    // Redactor verification
    const dirty = {
      user: "admin",
      password: "SuperSecretPassword123!",
      api_key: "ai_abc12345",
      nested: {
        token: "jwt.token.here",
        safeVal: 42
      }
    };
    const cleaned = sanitizeMetadata(dirty) as Record<string, any>;
    assert.equal(cleaned.user, "admin");
    assert.equal(cleaned.password, "[REDACTED]");
    assert.equal(cleaned.api_key, "[REDACTED]");
    assert.equal(cleaned.nested.token, "[REDACTED]");
    assert.equal(cleaned.nested.safeVal, 42);
  });

  await t.test("ProjectRegistry: Register, list, archive, access", () => {
    const regDir = path.join(tmpDir, "registry_data");
    const registry = new ProjectRegistry(regDir);

    const projFolder = path.join(tmpDir, "test_proj_1");
    fs.mkdirSync(projFolder, { recursive: true });

    const p1 = registry.registerProject({
      name: "Payroll Test Project",
      canonicalPath: projFolder,
      technology: "Python/Streamlit"
    });

    assert.ok(p1.id);
    assert.equal(p1.name, "Payroll Test Project");
    assert.equal(p1.is_archived, 0);

    // Re-registration of same path returns existing record
    const p1Dup = registry.registerProject({
      name: "Duplicate",
      canonicalPath: projFolder
    });
    assert.equal(p1Dup.id, p1.id);

    // List active
    const list = registry.listProjects();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, p1.id);

    // Archive
    registry.archiveProject(p1.id);
    assert.equal(registry.listProjects(false).length, 0);
    assert.equal(registry.listProjects(true).length, 1);

    // Unarchive
    registry.unarchiveProject(p1.id);
    assert.equal(registry.listProjects(false).length, 1);

    registry.close();
  });

  await t.test("ProjectMemory: Nodes, Edges, and FTS5 Search", () => {
    const memDbPath = path.join(tmpDir, "memory_test.db");
    const memory = new ProjectMemory(memDbPath, "proj_test_p2");

    // Add nodes
    const nodeA = memory.addNode({
      entityType: "MODULE",
      name: "auth_service.py",
      filePath: "src/services/auth.py",
      summary: "Handles user authentication and password validation",
      fullContent: "def authenticate(user, password): pass",
      metadata: { author: "alice", token: "should-be-scrubbed" }
    });

    const nodeB = memory.addNode({
      entityType: "DATABASE_TABLE",
      name: "users",
      summary: "Stores hashed credentials and roles",
      fullContent: "CREATE TABLE users (id INT, username TEXT);"
    });

    assert.ok(nodeA.id);
    assert.ok(nodeB.id);

    // Verify metadata scrubbing
    const parsedMeta = JSON.parse(nodeA.metadata_json);
    assert.equal(parsedMeta.author, "alice");
    assert.equal(parsedMeta.token, "[REDACTED]");

    // Connect edge
    const edge = memory.addEdge({
      sourceId: nodeA.id,
      targetId: nodeB.id,
      relationType: "DEPENDS_ON",
      weight: 1.5
    });

    assert.ok(edge.id);
    assert.equal(edge.relation_type, "DEPENDS_ON");

    // Query neighbors
    const neighbors = memory.getNeighbors(nodeA.id, "out");
    assert.equal(neighbors.length, 1);
    assert.equal(neighbors[0].node.id, nodeB.id);

    // FTS5 Full Text Search
    const searchResults = memory.searchFts("password");
    assert.equal(searchResults.length, 1);
    assert.equal(searchResults[0].id, nodeA.id);

    const searchHashed = memory.searchFts("credentials");
    assert.equal(searchHashed.length, 1);
    assert.equal(searchHashed[0].id, nodeB.id);

    // Subgraph extraction
    const graph = memory.getGraph();
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.edges.length, 1);

    memory.close();
  });

  await t.test("TaskManager: Lifecycle, DAG Dependencies, Handover", () => {
    const memDbPath = path.join(tmpDir, "task_test.db");
    const memory = new ProjectMemory(memDbPath, "proj_task_p2");
    const tm = new TaskManager(memory.getRawDb(), "proj_task_p2");

    // Create tasks
    const t1 = tm.createTask({ title: "Setup Database Schema", priority: "HIGH" });
    const t2 = tm.createTask({ title: "Implement Auth Service", priority: "CRITICAL" });
    const t3 = tm.createTask({ title: "Author Integration Tests", priority: "MEDIUM" });

    assert.equal(t1.status, "BACKLOG");

    // Dependencies: t2 depends on t1, t3 depends on t2
    tm.addDependency(t2.id, t1.id);
    tm.addDependency(t3.id, t2.id);

    assert.deepEqual(tm.getDependencies(t2.id), [t1.id]);
    assert.deepEqual(tm.getDependencies(t3.id), [t2.id]);
    assert.deepEqual(tm.getDependents(t1.id), [t2.id]);

    // Cycle detection: try to make t1 depend on t3 (Cycle: t1 -> t3 -> t2 -> t1)
    assert.throws(
      () => tm.addDependency(t1.id, t3.id),
      /Cycle detected/
    );

    // Status transitions
    tm.updateTaskStatus(t1.id, "IN_PROGRESS");
    assert.equal(tm.getTask(t1.id)?.status, "IN_PROGRESS");

    tm.updateTaskStatus(t1.id, "COMPLETED");
    const completedT1 = tm.getTask(t1.id)!;
    assert.equal(completedT1.status, "COMPLETED");
    assert.ok(completedT1.completed_at);

    // Artifacts
    tm.addArtifact({
      taskId: t1.id,
      artifactType: "SCHEMA_SQL",
      pathOrUri: "src/db/init.sql"
    });
    const arts = tm.getArtifacts(t1.id);
    assert.equal(arts.length, 1);
    assert.equal(arts[0].artifact_type, "SCHEMA_SQL");

    // Handover summary
    const handover = tm.generateHandoverSummary(t1.id);
    assert.match(handover, /# Task Handover: Setup Database Schema/);
    assert.match(handover, /src\/db\/init\.sql/);

    memory.close();
  });

  await t.test("AgentRegistry: Resource Locks & Activities", () => {
    const memDbPath = path.join(tmpDir, "agent_test.db");
    const memory = new ProjectMemory(memDbPath, "proj_agent_p2");
    const agents = new AgentRegistry(memory.getRawDb());

    // Profiles check
    const profiles = agents.listProfiles();
    assert.ok(profiles.length >= 10);
    assert.equal(agents.getProfile("coordinator")?.name, "Swarm Coordinator");

    // Resource Lock acquisition
    const uri = "file:///src/models/payroll.py";
    const acquired = agents.acquireLock(uri, "agent_alpha", "proj_agent_p2", 2); // 2 second TTL
    assert.equal(acquired, true);

    // Conflict: another agent tries to lock same resource
    const conflict = agents.acquireLock(uri, "agent_beta", "proj_agent_p2", 2);
    assert.equal(conflict, false);

    // Same agent can renew
    const renewed = agents.renewLock(uri, "agent_alpha", 5);
    assert.equal(renewed, true);

    // Release
    const released = agents.releaseLock(uri, "agent_alpha");
    assert.equal(released, true);

    // Now beta can acquire
    const acquiredBeta = agents.acquireLock(uri, "agent_beta", "proj_agent_p2", 1);
    assert.equal(acquiredBeta, true);

    // Activity Logging
    agents.logActivity({
      projectId: "proj_agent_p2",
      agentId: "agent_alpha",
      actionType: "REFACTOR_FUNCTION",
      details: { function: "calculate_tax" }
    });

    const acts = agents.getRecentActivities("proj_agent_p2");
    assert.equal(acts.length, 1);
    assert.equal(acts[0].action_type, "REFACTOR_FUNCTION");

    memory.close();
  });
});
