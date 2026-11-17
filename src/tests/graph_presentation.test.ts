import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProjectMemory } from "../core/memory/project_memory.js";
import { GraphPresentation } from "../core/graph/graph_presentation.js";
import { ProvenanceEngine } from "../core/memory/provenance_engine.js";

test("Graph presentation stays read-only and exposes nested clusters, pagination, and evidence", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superfyy_presentation_"));
  const memory = new ProjectMemory(path.join(dir, "memory.db"), "presentation_test");
  try {
    new ProvenanceEngine(memory.getRawDb(), memory.projectId);
    memory.addNode({ id: "folder_src", entityType: "FOLDER", name: "src", filePath: "src", metadata: { provenance: "VERIFIED" } });
    memory.addNode({ id: "folder_nested", entityType: "FOLDER", name: "feature", filePath: "src/feature", metadata: { provenance: "VERIFIED" } });
    memory.addNode({ id: "folder_docs", entityType: "FOLDER", name: "docs", filePath: "docs", metadata: { provenance: "VERIFIED" } });
    const modules = Array.from({ length: 40 }, (_, i) => memory.addNode({
      id: `module_${i}`, entityType: "MODULE", name: `module${i}`, filePath: `src/module${i}.ts`,
      fullContent: "private source", metadata: { provenance: "VERIFIED" }
    }));
    const doc = memory.addNode({ id: "doc_readme", entityType: "DOCUMENT", name: "README", filePath: "docs/README.md", metadata: { provenance: "DOCUMENTATION_BASED" } });
    memory.addEdge({ id: "edge_evidence", sourceId: modules[0].id, targetId: doc.id, relationType: "DOCUMENTS", metadata: { provenance: "VERIFIED", evidence: "source comment" } });

    const db = memory.getRawDb();
    const counts = () => db.prepare("SELECT (SELECT count(*) FROM graph_nodes WHERE project_id = ?) AS nodes, (SELECT count(*) FROM graph_edges WHERE project_id = ?) AS edges").get(memory.projectId, memory.projectId) as { nodes: number; edges: number };
    const before = counts();
    const presentation = new GraphPresentation(memory);
    const overview = presentation.getOverview("Demo");
    assert.equal(overview.project.id, "presentation_test");
    assert.ok(overview.visibleNodeCount >= 2);
    assert.ok(overview.nodes[0].initialPos);
    assert.ok(Number.isFinite(overview.nodes[0].initialPos.x));
    assert.ok(overview.links.some(edge => edge.source === "folder:src" && edge.target === "folder:docs" && edge.evidence.includes("source comment")));
    assert.ok(overview.connectivity);
    assert.ok(overview.connectivity.connectedComponentsCount >= 1);
    assert.equal(overview.connectivity.aggregatedEdgesCount, overview.links.length);

    const first = presentation.getCluster("folder:src", { offset: 0, limit: 2 });
    assert.equal(first.childClusters.length, 1);
    assert.ok(first.nodes[0].initialPos);
    assert.ok(Number.isFinite(first.nodes[0].initialPos.x));
    assert.equal(first.nodes.filter(node => node.kind === "CLUSTER").length, 1);
    assert.equal(new Set(first.nodes.map(node => node.id)).size, first.nodes.length);
    assert.equal(first.hasMore, true);
    const second = presentation.getCluster("folder:src", { offset: 2, limit: 2 });
    assert.equal(second.offset, 2);
    assert.equal(second.nodes.filter(node => node.kind !== "CLUSTER").length, 2);

    const evidence = new ProvenanceEngine(memory.getRawDb(), memory.projectId);
    evidence.recordEvidence({ nodeId: modules[0].id, statement: "verified relation", sourceType: "FILE", sourcePath: "src/module0.ts", agentId: "test_agent", taskId: "test_task" });
    const detail = presentation.getEntityDetail(modules[0].id, "Demo");
    assert.equal("fullContent" in detail.entity, false);
    assert.equal(detail.relationships.length, 1);
    assert.equal(detail.relationships[0].node.id, doc.id);
    assert.equal(detail.evidence.length, 1);
    assert.deepEqual(counts(), before);
  } finally {
    memory.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
