import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { ProjectMemory } from "../core/memory/project_memory.js";
import { GraphEngine } from "../core/graph/graph_engine.js";

test("SUPER FYY Phase P3 — Knowledge Graph Engine Test Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "superfyy_p3_test_"));
  const dbPath = path.join(tmpDir, "p3_graph.db");
  const memory = new ProjectMemory(dbPath, "proj_p3_test");
  const graphEngine = new GraphEngine(memory);

  t.after(() => {
    try {
      memory.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test("Graph Construction & Shortest Path", () => {
    // Pipeline: Controller -> Service -> Model -> Database
    const controller = graphEngine.addEntity({
      entityType: "MODULE",
      name: "PayrollController",
      filePath: "src/controllers/payroll.py"
    });

    const service = graphEngine.addEntity({
      entityType: "CLASS",
      name: "PayrollCalculator",
      filePath: "src/services/calc.py"
    });

    const model = graphEngine.addEntity({
      entityType: "CLASS",
      name: "SalaryRecord",
      filePath: "src/models/salary.py"
    });

    const dbTable = graphEngine.addEntity({
      entityType: "DATABASE_TABLE",
      name: "payroll_records"
    });

    // Edges
    graphEngine.connectEntities({ sourceId: controller.id, targetId: service.id, relationType: "CALLS" });
    graphEngine.connectEntities({ sourceId: service.id, targetId: model.id, relationType: "DEPENDS_ON" });
    graphEngine.connectEntities({ sourceId: model.id, targetId: dbTable.id, relationType: "MODIFIES" });

    // Path finding
    const path = graphEngine.findShortestPath(controller.id, dbTable.id);
    assert.deepEqual(path, [controller.id, service.id, model.id, dbTable.id]);

    // Unconnected path returns null
    const orphan = graphEngine.addEntity({ entityType: "DOCUMENT", name: "Architecture.md" });
    assert.equal(graphEngine.findShortestPath(controller.id, orphan.id), null);
  });

  await t.test("Impact Analysis: Upstream & Downstream", () => {
    // Nodes: TestSuite -> Service -> DB
    const service = memory.queryNodes({ entityType: "CLASS" }).find(n => n.name === "PayrollCalculator")!;
    const testCase = graphEngine.addEntity({
      entityType: "TEST",
      name: "test_payroll_calculation.py",
      filePath: "tests/test_payroll.py"
    });

    // testCase tested service (edge: testCase -> service)
    graphEngine.connectEntities({
      sourceId: testCase.id,
      targetId: service.id,
      relationType: "TESTED_BY"
    });

    const impact = graphEngine.getImpactAnalysis(service.id);

    // Downstream: SalaryRecord, payroll_records
    const downstreamNames = impact.downstream.map(n => n.name);
    assert.ok(downstreamNames.includes("SalaryRecord"));
    assert.ok(downstreamNames.includes("payroll_records"));

    // Upstream: PayrollController, test_payroll_calculation.py
    const upstreamNames = impact.upstream.map(n => n.name);
    assert.ok(upstreamNames.includes("PayrollController"));
    assert.ok(upstreamNames.includes("test_payroll_calculation.py"));
  });

  await t.test("3D Spherical Graph Export", () => {
    const spherical = graphEngine.exportSphericalGraph({ sphereRadius: 400 });

    assert.ok(spherical.nodes.length >= 5);
    assert.ok(spherical.links.length >= 4);

    for (const node of spherical.nodes) {
      assert.ok(node.id);
      assert.ok(node.group >= 1 && node.group <= 15);
      assert.ok(node.val >= 2);
      assert.ok(node.initialPos);
      assert.ok(Number.isFinite(node.initialPos.x));
      assert.ok(Number.isFinite(node.initialPos.y));
      assert.ok(Number.isFinite(node.initialPos.z));

      // Radius check: sqrt(x^2 + y^2 + z^2) ~ 400
      const d = Math.sqrt(
        node.initialPos.x ** 2 + node.initialPos.y ** 2 + node.initialPos.z ** 2
      );
      assert.ok(Math.abs(d - 400) < 1.0, `Expected ~400, got ${d}`);
    }
  });
});
