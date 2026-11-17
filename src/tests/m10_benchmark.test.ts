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
import { SwarmCoordinator } from "../core/agents/coordinator.js";
import { ContextGuard } from "../core/security/context_guard.js";
import { TaskCapsuleManager } from "../core/tasks/task_capsule.js";
import { ProvenanceEngine } from "../core/memory/provenance_engine.js";
import { DecisionLedger } from "../core/decisions/decision_ledger.js";
import { ContextBuilder } from "../core/memory/context_builder.js";

test("SUPER FYY Phase M10 — Complete Memory Intelligence & Context Guard Benchmark Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "superfyy_m10_bench_"));
  const registry = new ProjectRegistry(tmpDir);
  const contextGuard = new ContextGuard(registry);

  // Setup Project Alpha
  const folderAlpha = path.join(tmpDir, "PROJECT_ALPHA");
  fs.mkdirSync(folderAlpha, { recursive: true });
  const projAlpha = registry.registerProject({
    name: "Project Alpha Enterprise",
    canonicalPath: folderAlpha,
    technology: "TypeScript/Node"
  });

  // Setup Project Beta
  const folderBeta = path.join(tmpDir, "PROJECT_BETA");
  fs.mkdirSync(folderBeta, { recursive: true });
  const projBeta = registry.registerProject({
    name: "Project Beta Analytics",
    canonicalPath: folderBeta,
    technology: "Python/FastAPI"
  });

  const memAlpha = new ProjectMemory(projAlpha.memory_db_path, projAlpha.id);
  const memBeta = new ProjectMemory(projBeta.memory_db_path, projBeta.id);

  const capsuleMgrAlpha = new TaskCapsuleManager(memAlpha.getRawDb(), projAlpha.id);
  const capsuleMgrBeta = new TaskCapsuleManager(memBeta.getRawDb(), projBeta.id);

  const provAlpha = new ProvenanceEngine(memAlpha.getRawDb(), projAlpha.id);
  const provBeta = new ProvenanceEngine(memBeta.getRawDb(), projBeta.id);

  const decAlpha = new DecisionLedger(memAlpha.getRawDb(), projAlpha.id);
  const decBeta = new DecisionLedger(memBeta.getRawDb(), projBeta.id);

  const builderAlpha = new ContextBuilder(memAlpha);
  const coordinatorAlpha = new SwarmCoordinator(memAlpha);

  t.after(() => {
    try {
      memAlpha.close();
      memBeta.close();
      registry.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // Benchmark 1: Project Isolation
  await t.test("Benchmark 1: Multi-Project Strict Isolation (Alpha vs Beta)", () => {
    memAlpha.addNode({
      entityType: "MODULE",
      name: "AlphaKernelEngine",
      summary: "Proprietary internal calculation engine for Alpha"
    });

    memBeta.addNode({
      entityType: "MODULE",
      name: "BetaDataPipeline",
      summary: "Data ETL ingestion pipeline for Beta"
    });

    const resultsInAlpha = memAlpha.searchFts("BetaDataPipeline");
    assert.equal(resultsInAlpha.length, 0, "Alpha search MUST NOT find Beta entities");

    const resultsInBeta = memBeta.searchFts("AlphaKernelEngine");
    assert.equal(resultsInBeta.length, 0, "Beta search MUST NOT find Alpha entities");

    const alphaHits = memAlpha.searchFts("calculation engine");
    assert.equal(alphaHits.length, 1);
    assert.equal(alphaHits[0].name, "AlphaKernelEngine");
  });

  // Benchmark 2: Task Isolation
  await t.test("Benchmark 2: Task Context Capsule Isolation", () => {
    capsuleMgrAlpha.createCapsule({
      taskId: "task_alpha_01",
      projectId: projAlpha.id,
      taskName: "Migrate Auth Middleware",
      userRequest: "Refactor auth middleware to verify Bearer tokens",
      objective: "Replace session cookie logic with JWT validation",
      inScopePaths: ["src/auth/jwt.ts", "src/middleware/auth.ts"],
      outOfScopePaths: ["src/billing/**", "src/models/user.ts"],
      constraints: ["Maintain zero touch on database migrations"],
      acceptanceCriteria: ["All JWT tests pass", "Zero regression on existing API"]
    });

    capsuleMgrBeta.createCapsule({
      taskId: "task_beta_01",
      projectId: projBeta.id,
      taskName: "Deploy Redis Cache",
      userRequest: "Setup redis cluster for cache warming",
      objective: "Reduce DB load by 40%",
      inScopePaths: ["src/cache/**"],
      outOfScopePaths: ["src/core/**"],
      constraints: ["Do not alter Redis default eviction policy"],
      acceptanceCriteria: ["Redis ping succeeds in <2ms"]
    });

    const capA = capsuleMgrAlpha.getCapsule("task_alpha_01");
    assert.ok(capA);
    assert.equal(capA.task_name, "Migrate Auth Middleware");
    assert.deepEqual(capA.in_scope_paths, ["src/auth/jwt.ts", "src/middleware/auth.ts"]);

    // Ensure Beta cannot see Alpha's capsule
    const crossCheck = capsuleMgrBeta.getCapsule("task_alpha_01");
    assert.equal(crossCheck, null, "Beta MUST NOT access Alpha capsules");
  });

  // Benchmark 3: Decision Retrieval
  await t.test("Benchmark 3: Decision Retrieval with Rationale & Constraints", () => {
    const dec = decAlpha.recordDecision({
      taskId: "task_alpha_01",
      title: "Adopt SQLite WAL Mode for High Concurrency",
      context: "Application encountered database locking during concurrent writes",
      decision: "Mandate PRAGMA journal_mode=WAL on all SQLite connections",
      reason: "Permits concurrent readers while writer commits without contention",
      consequences: "Requires handling shm and wal companion files",
      createdBy: "agent_architect",
      approvedBy: "tech_lead_user",
      status: "ACCEPTED"
    });

    assert.ok(dec.id);
    const retrieved = decAlpha.getDecision(dec.id);
    assert.ok(retrieved);
    assert.equal(retrieved.status, "ACCEPTED");
    assert.equal(retrieved.approved_by, "tech_lead_user");
    assert.match(retrieved.decision, /journal_mode=WAL/);

    const activeList = decAlpha.listDecisions({ status: "ACCEPTED" });
    assert.ok(activeList.some(d => d.id === dec.id));
  });

  // Benchmark 4: Superseded Decision Handling
  await t.test("Benchmark 4: Superseded Decision Audit Trail & Successor Linking", () => {
    const originalDec = decAlpha.recordDecision({
      title: "Use In-Memory Session Cache",
      context: "Initial prototype required fast ephemeral sessions",
      decision: "Store sessions in memory Map",
      reason: "Simplicity during prototype phase",
      createdBy: "agent_prototype",
      approvedBy: "lead_dev",
      status: "ACCEPTED"
    });

    const { oldDecision, newDecision } = decAlpha.supersedeDecision(originalDec.id, {
      title: "Use Redis Session Storage",
      context: "Cluster deployment requires distributed session access across instances",
      decision: "Store sessions in Redis with TTL",
      reason: "Memory Map cannot scale across multi-instance nodes",
      createdBy: "agent_architect",
      approvedBy: "lead_dev",
      status: "ACCEPTED"
    });

    assert.equal(oldDecision.status, "SUPERSEDED", "Old decision must transition to SUPERSEDED");
    assert.equal(newDecision.status, "ACCEPTED", "New decision must be marked ACCEPTED");
    assert.equal(newDecision.superseded_decision_id, originalDec.id, "Successor must link to predecessor ID");

    // Superseded decision should not appear in active filter
    const active = decAlpha.listDecisions({ status: "ACCEPTED" });
    assert.ok(!active.some(d => d.id === originalDec.id));
    assert.ok(active.some(d => d.id === newDecision.id));
  });

  // Benchmark 5: Contradiction Detection
  await t.test("Benchmark 5: Contradiction Detection against Active Decisions", () => {
    decAlpha.recordDecision({
      title: "Mandate SQLite Embedded Engine",
      context: "Single-binary deployment without external database server",
      decision: "Mandate SQLite exclusively; prohibit MySQL or Postgres servers",
      reason: "Local self-contained packaging without Docker dependency",
      createdBy: "lead_architect",
      approvedBy: "system_owner",
      status: "ACCEPTED"
    });

    // Case A: Statement suggesting conflicting tech
    const conflictReports = decAlpha.detectContradictions("Let us migrate all database tables to MySQL server for scaling");
    assert.ok(conflictReports.length > 0, "Must detect contradiction when proposing MySQL against SQLite mandate");
    assert.equal(conflictReports[0].contradictionDetected, true);
    assert.match(conflictReports[0].reason, /conflicts with accepted decision/);

    // Case B: Non-conflicting statement
    const safeReports = decAlpha.detectContradictions("Add indexes to optimize SQLite query performance");
    assert.equal(safeReports.length, 0, "Safe statement must produce zero contradiction alerts");
  });

  // Benchmark 6: Stale Memory Detection
  await t.test("Benchmark 6: Stale Memory Detection via File Hash Invalidation", () => {
    const testFile = path.join(folderAlpha, "src", "config.json");
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, JSON.stringify({ version: "1.0.0", port: 8080 }));

    const initialHash = provAlpha.computeFileHash(testFile)!;
    assert.ok(initialHash);

    const evidence = provAlpha.recordEvidence({
      statement: "Server configuration defaults to port 8080 with version 1.0.0",
      sourceType: "FILE",
      sourcePath: "src/config.json",
      lineRange: "1-2",
      fileHash: initialHash,
      agentId: "agent_auditor",
      status: "VERIFIED"
    });

    assert.equal(evidence.status, "VERIFIED");

    // Freshness check before modification
    const freshCheckBefore = provAlpha.verifyFreshness(folderAlpha, "src/config.json");
    assert.equal(freshCheckBefore.fresh, true);
    assert.equal(freshCheckBefore.staleUpdatedCount, 0);

    // Modify the file on disk
    fs.writeFileSync(testFile, JSON.stringify({ version: "2.0.0", port: 9000 }));

    // Freshness check after modification
    const freshCheckAfter = provAlpha.verifyFreshness(folderAlpha, "src/config.json");
    assert.equal(freshCheckAfter.fresh, false, "Must detect file modification");
    assert.equal(freshCheckAfter.staleUpdatedCount, 1, "Must update 1 evidence record to STALE");

    const staleList = provAlpha.listStaleMemories();
    assert.ok(staleList.some(e => e.id === evidence.id));
  });

  // Benchmark 7: Task Handover Integrity
  await t.test("Benchmark 7: Task Handover Generation across Simulated Sessions", () => {
    const tm = new TaskManager(memAlpha.getRawDb(), projAlpha.id);
    const t1 = tm.createTask({
      title: "Audit Password Hashing",
      priority: "CRITICAL",
      description: "Ensure argon2id or bcrypt is used with adequate cost factor"
    });

    tm.updateTaskStatus(t1.id, "COMPLETED");
    tm.addArtifact({
      taskId: t1.id,
      artifactType: "REPORT",
      pathOrUri: "reports/audit_hashing.md"
    });

    const handover = tm.generateHandoverSummary(t1.id);
    assert.match(handover, /Audit Password Hashing/);
    assert.match(handover, /reports\/audit_hashing.md/);
    assert.match(handover, /COMPLETED/);
  });

  // Benchmark 8: Source Evidence Verification
  await t.test("Benchmark 8: Verifiable Source Evidence with File, Line Range, and SHA-256", () => {
    const dummyFile = path.join(folderAlpha, "src", "security.ts");
    fs.writeFileSync(dummyFile, "export const HASH_ROUNDS = 12;\nexport const PEPPER = 'super-secret';\n");

    const fileHash = provAlpha.computeFileHash(dummyFile)!;
    const evi = provAlpha.recordEvidence({
      statement: "Password hashing uses 12 rounds in security.ts",
      sourceType: "FILE",
      sourcePath: "src/security.ts",
      lineRange: "1-1",
      fileHash: fileHash,
      agentId: "sec_agent",
      status: "VERIFIED"
    });

    assert.equal(evi.source_path, "src/security.ts");
    assert.equal(evi.line_range, "1-1");
    assert.equal(evi.file_hash, fileHash);
    assert.equal(evi.status, "VERIFIED");
  });

  // Benchmark 9: Unverified Claim Identification
  await t.test("Benchmark 9: Explicit Labeling of Unverified Claims", () => {
    const unverifiedEvi = provAlpha.recordEvidence({
      statement: "External payment gateway is reported to be undergoing maintenance at 3 AM",
      sourceType: "REPORT",
      sourcePath: "notes/rumors.txt",
      agentId: "agent_ops",
      status: "UNVERIFIED"
    });

    const retrieved = provAlpha.getEvidence(unverifiedEvi.id);
    assert.ok(retrieved);
    assert.equal(retrieved.status, "UNVERIFIED", "Status must remain UNVERIFIED until backed by file/test");
  });

  // Benchmark 10: Anti-Drift Guard
  await t.test("Benchmark 10: Anti-Drift Guard and Execution Contract Enforcement", () => {
    const contract = capsuleMgrAlpha.generateExecutionContract("task_alpha_01");

    // Case A: Action within authorized in-scope path
    const safeCheck = contextGuard.verifyActionAgainstContract(contract, {
      targetPath: "src/auth/jwt.ts",
      operation: "EDIT_FILE"
    });
    assert.equal(safeCheck.allowed, true);

    // Case B: Action touching out-of-scope path
    const driftCheck = contextGuard.verifyActionAgainstContract(contract, {
      targetPath: "src/billing/invoice.ts",
      operation: "EDIT_FILE"
    });
    assert.equal(driftCheck.allowed, false);
    assert.equal(driftCheck.violationType, "SCOPE_VIOLATION");
    assert.match(driftCheck.reason!, /outside the authorized scope/);

    // Case C: Prohibited operation
    const forbiddenContract = {
      ...contract,
      forbiddenOperations: ["ALTER_PAYROLL_FORMULA", "DROP_TABLE"]
    };
    const opCheck = contextGuard.verifyActionAgainstContract(forbiddenContract, {
      targetPath: "src/auth/jwt.ts",
      operation: "DROP_TABLE"
    });
    assert.equal(opCheck.allowed, false);
    assert.equal(opCheck.violationType, "OPERATION_FORBIDDEN");
  });

  // Benchmark 11: Concurrent Lock Safety
  await t.test("Benchmark 11: Concurrent Resource Lock Conflict Resolution", () => {
    const agents = new AgentRegistry(memAlpha.getRawDb());
    const lockUri = "file:///src/models/user.ts";

    // Agent 1 acquires lock
    const lockedBy1 = agents.acquireLock(lockUri, "agent_1", projAlpha.id, 60);
    assert.equal(lockedBy1, true, "First agent should successfully acquire lock");

    // Agent 2 attempts to acquire same resource
    const lockedBy2 = agents.acquireLock(lockUri, "agent_2", projAlpha.id, 60);
    assert.equal(lockedBy2, false, "Second agent MUST be denied lock while active");

    // Agent 1 releases lock
    const released = agents.releaseLock(lockUri, "agent_1");
    assert.equal(released, true);

    // Agent 2 re-attempts
    const lockedBy2After = agents.acquireLock(lockUri, "agent_2", projAlpha.id, 60);
    assert.equal(lockedBy2After, true, "Second agent can acquire lock after release");

    agents.releaseLock(lockUri, "agent_2");
  });

  // Benchmark 12: Agent Permission Boundaries
  await t.test("Benchmark 12: Role-Based Agent Permission Boundaries (READ_ONLY vs TASK_WORKER)", () => {
    coordinatorAlpha.setAgentPermission("viewer_agent", "READ_ONLY");
    coordinatorAlpha.setAgentPermission("worker_agent", "TASK_WORKER");

    // Worker agent should be allowed to start task
    const tm = new TaskManager(memAlpha.getRawDb(), projAlpha.id);
    const tWork = tm.createTask({ title: "Worker Assigned Task" });

    const workerResult = coordinatorAlpha.startTask(tWork.id, "worker_agent");
    assert.equal(workerResult.success, true);

    // READ_ONLY agent should be blocked with Permission Denied
    const tRead = tm.createTask({ title: "Read-only Target Task" });
    assert.throws(
      () => coordinatorAlpha.startTask(tRead.id, "viewer_agent"),
      /Permission Denied: Agent 'viewer_agent' has READ_ONLY permission/
    );
  });
});
