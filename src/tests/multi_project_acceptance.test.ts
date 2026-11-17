import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

import { ProjectRegistry } from "../core/registry/project_registry.js";
import { ProjectMemory } from "../core/memory/project_memory.js";
import { TaskManager } from "../core/tasks/task_manager.js";
import { AgentRegistry } from "../core/agents/agent_registry.js";

test("SUPER FYY Phase P9 — Multi-Project Isolation & Integrity Acceptance Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "superfyy_p9_acceptance_"));
  const registry = new ProjectRegistry(tmpDir);

  t.after(() => {
    try {
      registry.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // Verify baseline SHA-256 of synthetic external workspace fixture
  const externalDbDir = path.join(tmpDir, "external_workspace");
  fs.mkdirSync(externalDbDir, { recursive: true });
  const externalDbPath = path.join(externalDbDir, "external_fixture.db");
  fs.writeFileSync(externalDbPath, "IMMUTABLE_EXTERNAL_FIXTURE_CONTENT_12345");
  const baselineHash = crypto.createHash("sha256").update(fs.readFileSync(externalDbPath)).digest("hex").toUpperCase();

  // Create Project A
  const folderA = path.join(tmpDir, "PROJECT_A");
  fs.mkdirSync(folderA, { recursive: true });
  const projA = registry.registerProject({
    name: "Project Alpha",
    canonicalPath: folderA,
    technology: "React/Next.js"
  });

  // Create Project B
  const folderB = path.join(tmpDir, "PROJECT_B");
  fs.mkdirSync(folderB, { recursive: true });
  const projB = registry.registerProject({
    name: "Project Beta",
    canonicalPath: folderB,
    technology: "Python/FastAPI"
  });

  // Initialize isolated memory engines
  const memA = new ProjectMemory(projA.memory_db_path, projA.id);
  const memB = new ProjectMemory(projB.memory_db_path, projB.id);

  const tmA = new TaskManager(memA.getRawDb(), projA.id);
  const tmB = new TaskManager(memB.getRawDb(), projB.id);

  const agentsA = new AgentRegistry(memA.getRawDb());
  const agentsB = new AgentRegistry(memB.getRawDb());

  await t.test("Entity & Search Isolation: Zero Crosstalk between Projects", () => {
    // Add entity to Project A
    memA.addNode({
      entityType: "MODULE",
      name: "SuperSecretAlgorithmAlpha",
      summary: "Patented neural compression routine for project alpha"
    });

    // Add entity to Project B
    memB.addNode({
      entityType: "DATABASE_TABLE",
      name: "quantum_ledger_beta",
      summary: "Decentralized transaction store for project beta"
    });

    // FTS search in Project A
    const searchA_for_B = memA.searchFts("quantum_ledger");
    assert.equal(searchA_for_B.length, 0, "Project A search MUST NOT find Project B entities");

    const searchA_for_A = memA.searchFts("compression");
    assert.equal(searchA_for_A.length, 1);
    assert.equal(searchA_for_A[0].name, "SuperSecretAlgorithmAlpha");

    // FTS search in Project B
    const searchB_for_A = memB.searchFts("SuperSecretAlgorithm");
    assert.equal(searchB_for_A.length, 0, "Project B search MUST NOT find Project A entities");

    const searchB_for_B = memB.searchFts("transaction");
    assert.equal(searchB_for_B.length, 1);
    assert.equal(searchB_for_B[0].name, "quantum_ledger_beta");
  });

  await t.test("Task Isolation: Independent Task Lifecycles", () => {
    tmA.createTask({ title: "Alpha Task 1: UI Polish", priority: "HIGH" });
    tmB.createTask({ title: "Beta Task 1: API Setup", priority: "CRITICAL" });

    const tasksA = tmA.listTasks();
    const tasksB = tmB.listTasks();

    assert.equal(tasksA.length, 1);
    assert.equal(tasksA[0].title, "Alpha Task 1: UI Polish");

    assert.equal(tasksB.length, 1);
    assert.equal(tasksB[0].title, "Beta Task 1: API Setup");
  });

  await t.test("Resource Lock Isolation: Same relative URI in different projects", () => {
    const commonUri = "file:///src/main.ts";

    // Project A locks commonUri
    const lockA = agentsA.acquireLock(commonUri, "agent_1", projA.id, 60);
    assert.equal(lockA, true);

    // Project B locking the SAME URI in Project B must succeed (isolated scope)
    const lockB = agentsB.acquireLock(commonUri, "agent_2", projB.id, 60);
    assert.equal(lockB, true, "Locks in different projects must not conflict");

    // Conflict inside same project
    const conflictA = agentsA.acquireLock(commonUri, "agent_3", projA.id, 60);
    assert.equal(conflictA, false, "Same project must respect locks");
  });

  await t.test("Integrity Audit: External Workspace Zero Touch Verification", () => {
    const postHash = crypto.createHash("sha256").update(fs.readFileSync(externalDbPath)).digest("hex").toUpperCase();
    assert.equal(postHash, baselineHash, "CRITICAL: external workspace file was altered!");
  });

  memA.close();
  memB.close();
});
