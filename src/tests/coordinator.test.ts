import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { ProjectMemory } from "../core/memory/project_memory.js";
import { TaskManager } from "../core/tasks/task_manager.js";
import { SwarmCoordinator } from "../core/agents/coordinator.js";

test("SUPER FYY Phase P5 — Multi-Agent Coordination Test Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "superfyy_p5_test_"));
  const dbPath = path.join(tmpDir, "p5_coord.db");
  const memory = new ProjectMemory(dbPath, "proj_p5_test");
  const tm = new TaskManager(memory.getRawDb(), "proj_p5_test");
  const coordinator = new SwarmCoordinator(memory);

  t.after(() => {
    try {
      memory.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test("Role Profile Heuristic Suggestion", () => {
    assert.equal(coordinator.suggestAgentForTask("Fix SQL query index in database").id, "dba");
    assert.equal(coordinator.suggestAgentForTask("Harden authentication and JWT token security").id, "security-auditor");
    assert.equal(coordinator.suggestAgentForTask("Redesign 3D graph view and CSS colors").id, "frontend-dev");
    assert.equal(coordinator.suggestAgentForTask("Author unit tests and test assertions").id, "test-engineer");
    assert.equal(coordinator.suggestAgentForTask("Build Windows NSIS installer package").id, "devops");
  });

  await t.test("Coordinated Workflow: Dependency gating, locking, and unblocking", () => {
    // Task 1: Setup schema
    const t1 = tm.createTask({ title: "Setup Database Table" });
    // Task 2: Build API (depends on Task 1)
    const t2 = tm.createTask({ title: "Build Auth API" });
    tm.addDependency(t2.id, t1.id);

    // Attempt to start Task 2 before Task 1 is complete -> MUST be blocked!
    const tryT2 = coordinator.startTask(t2.id, "backend-dev");
    assert.equal(tryT2.success, false);
    assert.equal(tryT2.task.status, "BLOCKED");
    assert.ok(tryT2.blockedBy && tryT2.blockedBy.length === 1);

    // Now start and complete Task 1 with resource locking
    const resourceUri = "file:///src/db/schema.sql";
    const startT1 = coordinator.startTask(t1.id, "dba", resourceUri);
    assert.equal(startT1.success, true);
    assert.equal(startT1.task.status, "IN_PROGRESS");
    assert.equal(startT1.lockAcquired, true);

    // Complete Task 1 -> should release lock and automatically unblock Task 2 to "TODO"
    const compT1 = coordinator.completeTask(t1.id, "dba", resourceUri);
    assert.equal(compT1.task.status, "COMPLETED");
    assert.deepEqual(compT1.unblockedTaskIds, [t2.id]);
    assert.equal(tm.getTask(t2.id)?.status, "TODO");

    // Now Task 2 can start cleanly
    const startT2 = coordinator.startTask(t2.id, "backend-dev");
    assert.equal(startT2.success, true);
    assert.equal(startT2.task.status, "IN_PROGRESS");
  });
});
