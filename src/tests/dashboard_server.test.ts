import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { DashboardServer } from "../dashboard/server.js";
import { ProjectRegistry } from "../core/registry/project_registry.js";
import { ProjectMemory } from "../core/memory/project_memory.js";

test("SUPER FYY Phase P6 — Dashboard HTTP & Graph Server Test Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "superfyy_p6_test_"));
  const publicDir = path.resolve("src/dashboard/public");

  // Setup sample project
  const registry = new ProjectRegistry(tmpDir);
  const sampleFolder = path.join(tmpDir, "demo_proj");
  fs.mkdirSync(sampleFolder, { recursive: true });

  const project = registry.registerProject({
    name: "Dashboard Demo App",
    canonicalPath: sampleFolder,
    technology: "Electron/React"
  });

  const memory = new ProjectMemory(project.memory_db_path, project.id);
  const appNode = memory.addNode({
    entityType: "MODULE",
    name: "AppRouter.tsx",
    filePath: "src/AppRouter.tsx",
    summary: "Root router managing application views"
  });
  memory.addNode({
    entityType: "MODULE",
    name: "Secondary.ts",
    filePath: "src/Secondary.ts",
    summary: "A secondary module"
  });
  memory.close();
  registry.close();

  const server = new DashboardServer(tmpDir, publicDir);
  const port = await server.listen(0); // Random free port
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    try {
      await server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test("GET / serves clustered graph dashboard HTML", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/html");
    const html = await res.text();
    assert.match(html, /SUPER FYY/);
    assert.match(html, /3D CLUSTERED SPHERICAL KNOWLEDGE GRAPH/);
  });

  await t.test("GET /api/projects returns registered projects", async () => {
    const res = await fetch(`${baseUrl}/api/projects`);
    assert.equal(res.status, 200);
    const data = await res.json() as any;
    assert.ok(data.projects.length >= 1);
    assert.equal(data.projects[0].name, "Dashboard Demo App");
  });

  await t.test("GET /api/projects/:id/graph returns legacy spherical nodes", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${project.id}/graph?radius=300`);
    assert.equal(res.status, 200);
    const data = await res.json() as any;
    assert.ok(data.nodes.length >= 1);
    assert.ok(data.nodes.some((node: any) => node.name === "AppRouter.tsx"));
    assert.ok(data.nodes[0].initialPos);
    assert.ok(Number.isFinite(data.nodes[0].initialPos.x));
  });

  await t.test("GET /api/projects/:id/graph?mode=overview returns clustered presentation", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${project.id}/graph?mode=overview`);
    assert.equal(res.status, 200);
    const data = await res.json() as any;
    assert.equal(data.project.id, project.id);
    assert.ok(data.storedNodeCount >= 1);
    assert.ok(data.nodes.some((node: any) => node.clusterId === "folder:src"));
    assert.ok(data.nodes[0].initialPos);
    assert.ok(Number.isFinite(data.nodes[0].initialPos.x));
    assert.ok(Number.isFinite(data.nodes[0].initialPos.y));
    assert.ok(Number.isFinite(data.nodes[0].initialPos.z));
    assert.ok(data.connectivity);
    assert.ok(Number.isInteger(data.connectivity.connectedComponentsCount));
    assert.ok(Array.isArray(data.connectivity.components));
  });

  await t.test("GET /api/projects/:id/connectivity returns graph topology diagnostics", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${project.id}/connectivity`);
    assert.equal(res.status, 200);
    const data = await res.json() as any;
    assert.equal(data.projectId, project.id);
    assert.ok(data.connectivity);
    assert.ok(Number.isInteger(data.connectivity.totalClusters));
    assert.ok(Array.isArray(data.connectivity.isolatedClusters));
    assert.ok(Array.isArray(data.aggregatedEdges));
  });

  await t.test("GET /api/projects/:id/graph?mode=cluster paginates persisted entities", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${project.id}/graph?mode=cluster&cluster=folder%3Asrc&limit=1`);
    assert.equal(res.status, 200);
    const data = await res.json() as any;
    assert.equal(data.totalEntities, 2);
    assert.equal(data.nodes.filter((node: any) => node.kind === "ENTITY").length, 1);
    assert.equal(data.hasMore, true);
    assert.ok(data.nodes[0].initialPos);
    assert.ok(Number.isFinite(data.nodes[0].initialPos.x));
    const secondPage = await fetch(`${baseUrl}/api/projects/${project.id}/graph?mode=cluster&cluster=folder%3Asrc&limit=1&offset=1`);
    assert.equal(secondPage.status, 200);
    const secondData = await secondPage.json() as any;
    assert.equal(secondData.nodes.filter((node: any) => node.kind === "ENTITY").length, 1);
    assert.equal(secondData.hasMore, false);
  });

  await t.test("Cluster type filters support selected and empty sets", async () => {
    const selected = await fetch(`${baseUrl}/api/projects/${project.id}/graph?mode=cluster&cluster=folder%3Asrc&types=MODULE`);
    assert.equal(selected.status, 200);
    const selectedData = await selected.json() as any;
    assert.equal(selectedData.totalEntities, 2);
    assert.equal(selectedData.nodes.find((node: any) => node.kind === "ENTITY")?.type, "MODULE");

    const empty = await fetch(`${baseUrl}/api/projects/${project.id}/graph?mode=cluster&cluster=folder%3Asrc&types=`);
    assert.equal(empty.status, 200);
    const emptyData = await empty.json() as any;
    assert.equal(emptyData.totalEntities, 0);
    assert.equal(emptyData.nodes.some((node: any) => node.kind === "ENTITY"), false);
  });

  await t.test("GET /api/projects/:id/graph?mode=entity excludes source content", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${project.id}/graph?mode=entity&entity=${encodeURIComponent(appNode.id)}`);
    assert.equal(res.status, 200);
    const data = await res.json() as any;
    assert.equal(data.entity.name, "AppRouter.tsx");
    assert.equal("full_content" in data.entity, false);
  });

  await t.test("Unknown project and cluster return client errors", async () => {
    const missingProject = await fetch(`${baseUrl}/api/projects/not_registered/graph?mode=overview`);
    assert.equal(missingProject.status, 404);
    const missingCluster = await fetch(`${baseUrl}/api/projects/${project.id}/graph?mode=cluster&cluster=folder%3Amissing`);
    assert.equal(missingCluster.status, 404);
  });

  await t.test("POST /api/projects/:id/search executes FTS5 query", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${project.id}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "router" })
    });
    assert.equal(res.status, 200);
    const data = await res.json() as any;
    assert.ok(data.results.length >= 1);
    assert.equal(data.results[0].name, "AppRouter.tsx");
  });
});
