import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { ProjectMemory } from "../core/memory/project_memory.js";
import { GraphPresentation } from "../core/graph/graph_presentation.js";
import { RootReconciler } from "../core/indexing/root_reconciler.js";

test("SUPER FYY Phase M11.3 — Hierarchical Relationship & Semantic Discovery Test Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "superfyy_m11_3_test_"));
  const dbPath = path.join(tmpDir, "memory.db");
  const projectId = "proj_test_m11_3";
  const memory = new ProjectMemory(dbPath, projectId);

  t.after(() => {
    try {
      memory.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // Setup mock project nodes
  const srcFolder = memory.addNode({
    entityType: "FOLDER",
    name: "src",
    filePath: "src",
    metadata: { provenance: "VERIFIED" }
  });
  const modelsFolder = memory.addNode({
    entityType: "FOLDER",
    name: "models",
    filePath: "models",
    metadata: { provenance: "VERIFIED" }
  });
  const templatesFolder = memory.addNode({
    entityType: "FOLDER",
    name: "templates",
    filePath: "templates",
    metadata: { provenance: "VERIFIED" }
  });
  const dsFolder = memory.addNode({
    entityType: "FOLDER",
    name: "design-system",
    filePath: "design-system",
    metadata: { provenance: "VERIFIED" }
  });
  const readmeFile = memory.addNode({
    entityType: "DOCUMENT",
    name: "README.md",
    filePath: "README.md",
    metadata: { provenance: "VERIFIED" }
  });
  const mlInference = memory.addNode({
    entityType: "MODULE",
    name: "inference.py",
    filePath: "src/ml/inference.py",
    metadata: { provenance: "VERIFIED" }
  });
  const dataImport = memory.addNode({
    entityType: "MODULE",
    name: "data_import.py",
    filePath: "src/ui/pages/data_import.py",
    metadata: { provenance: "VERIFIED" }
  });

  await t.test("1. Project Root creation and stable identity", () => {
    const res = RootReconciler.reconcileProjectRoot(memory, "Test Project M11.3");
    assert.equal(res.rootCreated, true);
    assert.equal(res.rootId, `root:${projectId}`);

    const db = memory.getRawDb();
    const rootNode = db.prepare("SELECT * FROM graph_nodes WHERE id = ?").get(`root:${projectId}`) as any;
    assert.ok(rootNode);
    assert.equal(rootNode.entity_type, "FOLDER");
    assert.equal(rootNode.file_path, ".");
    assert.match(rootNode.name, /Test Project M11.3/);
  });

  await t.test("2. Idempotent Project Root reconciliation (no duplicates)", () => {
    const res = RootReconciler.reconcileProjectRoot(memory, "Test Project M11.3");
    assert.equal(res.rootCreated, false);
    assert.equal(res.structuralEdgesAdded, 0);
  });

  await t.test("3. Structural containment edges (PROJECT_ROOT CONTAINS folders and files)", () => {
    const db = memory.getRawDb();
    const rootEdges = db.prepare(`
      SELECT e.*, t.name as target_name, t.entity_type as target_type
      FROM graph_edges e
      JOIN graph_nodes t ON t.id = e.target_id
      WHERE e.source_id = ? AND e.relation_type = 'CONTAINS'
    `).all(`root:${projectId}`) as any[];

    assert.ok(rootEdges.length >= 5);
    const targetNames = rootEdges.map(e => e.target_name);
    assert.ok(targetNames.includes("src"));
    assert.ok(targetNames.includes("models"));
    assert.ok(targetNames.includes("templates"));
    assert.ok(targetNames.includes("design-system"));
    assert.ok(targetNames.includes("README.md"));
  });

  await t.test("4. Verified Semantic Discovery links (models and templates)", () => {
    const db = memory.getRawDb();
    const modelsEdge = db.prepare(`
      SELECT * FROM graph_edges WHERE source_id = ? AND target_id = ? AND relation_type = 'REFERENCES'
    `).get(mlInference.id, modelsFolder.id) as any;
    assert.ok(modelsEdge);
    assert.match(modelsEdge.metadata_json, /inference\.py/);

    const tmplEdge = db.prepare(`
      SELECT * FROM graph_edges WHERE source_id = ? AND target_id = ? AND relation_type = 'REFERENCES'
    `).get(dataImport.id, templatesFolder.id) as any;
    assert.ok(tmplEdge);
    assert.match(tmplEdge.metadata_json, /data_import\.py/);
  });

  await t.test("5. Overview 3D presentation: Root at Center (0, 0, 0) and structural distinction", () => {
    const presentation = new GraphPresentation(memory);
    const overview = presentation.getOverview("Test Project M11.3");

    // Root node is at geometric center (0, 0, 0)
    const rootNode = overview.nodes.find(n => n.id === `root:${projectId}`);
    assert.ok(rootNode);
    assert.deepEqual(rootNode.initialPos, { x: 0, y: 0, z: 0 });
    assert.equal(rootNode.metadata?.isRoot, true);

    // Links are split into structural and functional
    const structLinks = overview.links.filter(l => l.structural === true);
    assert.ok(structLinks.length >= 4);
    assert.ok(structLinks.every(l => l.source === `root:${projectId}` && l.type === "CONTAINS"));

    const funcLinks = overview.links.filter(l => l.structural === false);
    assert.ok(funcLinks.length >= 1);
    assert.ok(funcLinks.some(l => l.source === "folder:src" && l.target === "folder:models"));
  });

  await t.test("6. Dual Connectivity Diagnostics (Structural vs Functional)", () => {
    const presentation = new GraphPresentation(memory);
    const overview = presentation.getOverview("Test Project M11.3");
    const diag = overview.connectivity;

    assert.ok(diag);
    // Structural: 1 unified tree connecting all clusters via root
    assert.equal(diag.structuralComponentsCount, 1);
    assert.ok((diag.structurallyConnectedCount || 0) >= 4);

    // Functional: separates connected clusters (src, models, templates) from isolated (design-system)
    assert.ok((diag.functionallyConnectedCount || 0) >= 2);
    assert.ok((diag.functionallyIsolatedCount || 0) >= 1);
    assert.ok(diag.isolatedClusters.includes("folder:design-system"));

    const dsDetails = diag.isolatedClusterDetails.find(d => d.id === "folder:design-system");
    assert.ok(dsDetails);
    assert.match(dsDetails.reason, /tokens|documentation|application source code/i);
  });

  await t.test("7. Cluster Inspector metadata: structural & functional counts", () => {
    const presentation = new GraphPresentation(memory);
    const overview = presentation.getOverview("Test Project M11.3");

    const srcNode = overview.nodes.find(n => n.id === "folder:src");
    assert.ok(srcNode);
    assert.equal(srcNode.metadata?.isStructurallyConnected, true);
    assert.equal(srcNode.metadata?.isFunctionallyIsolated, false);
    assert.equal(srcNode.metadata?.functionalStatus, "FUNCTIONALLY_CONNECTED");

    const dsNode = overview.nodes.find(n => n.id === "folder:design-system");
    assert.ok(dsNode);
    assert.equal(dsNode.metadata?.isStructurallyConnected, true);
    assert.equal(dsNode.metadata?.isFunctionallyIsolated, true);
    assert.equal(dsNode.metadata?.functionalStatus, "NO_VERIFIED_FUNCTIONAL_LINK");
  });
});
