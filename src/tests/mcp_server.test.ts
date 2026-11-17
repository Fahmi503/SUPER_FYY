import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SuperFyyMcpServer } from "../mcp/server.js";

test("SUPER FYY Phase P4 — MCP Server Integration Test Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "superfyy_mcp_test_"));
  const mcpServer = new SuperFyyMcpServer(tmpDir);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await mcpServer.getServer().connect(serverTransport);
  await client.connect(clientTransport);

  t.after(async () => {
    try {
      await client.close();
      await mcpServer.getServer().close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  let projectId = "";
  const testProjectFolder = path.join(tmpDir, "sample_project");
  fs.mkdirSync(testProjectFolder, { recursive: true });

  function parseRes(res: any): any {
    return JSON.parse((res.content as any)[0].text);
  }

  function getRawText(res: any): string {
    return (res.content as any)[0].text;
  }

  await t.test("MCP Tool: superfyy_register_project", async () => {
    const res = await client.callTool({
      name: "superfyy_register_project",
      arguments: {
        name: "Sample App",
        canonical_path: testProjectFolder,
        technology: "TypeScript/Node"
      }
    });

    assert.equal(res.isError, undefined);
    const content = parseRes(res);
    assert.ok(content.id);
    assert.equal(content.name, "Sample App");
    projectId = content.id;
  });

  await t.test("MCP Tool: superfyy_list_projects", async () => {
    const res = await client.callTool({
      name: "superfyy_list_projects",
      arguments: {}
    });

    assert.equal(res.isError, undefined);
    const list = parseRes(res);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, projectId);
  });

  let nodeAId = "";
  let nodeBId = "";

  await t.test("MCP Tools: superfyy_add_entity & superfyy_search_memory", async () => {
    // Add Node A
    const resA = await client.callTool({
      name: "superfyy_add_entity",
      arguments: {
        project_id: projectId,
        entity_type: "MODULE",
        name: "SecurityGateway",
        file_path: "src/security/gateway.ts",
        summary: "Enforces zero-trust authentication and rate limits",
        full_content: "export class SecurityGateway { checkAccess() { return true; } }",
        metadata: { tier: 1 }
      }
    });
    assert.equal(resA.isError, undefined);
    const nodeA = parseRes(resA);
    nodeAId = nodeA.id;

    // Add Node B
    const resB = await client.callTool({
      name: "superfyy_add_entity",
      arguments: {
        project_id: projectId,
        entity_type: "API_ENDPOINT",
        name: "POST /api/v1/auth/login",
        summary: "Login endpoint verifying credentials and emitting session tokens",
        metadata: { rate_limit: "10req/min" }
      }
    });
    assert.equal(resB.isError, undefined);
    const nodeB = parseRes(resB);
    nodeBId = nodeB.id;

    // Search FTS5
    const searchRes = await client.callTool({
      name: "superfyy_search_memory",
      arguments: {
        project_id: projectId,
        query: "rate limits"
      }
    });
    assert.equal(searchRes.isError, undefined);
    const results = parseRes(searchRes);
    assert.ok(results.length >= 1);
    assert.equal(results[0].id, nodeAId);
  });

  await t.test("MCP Tools: superfyy_connect_entities & superfyy_impact_analysis", async () => {
    const connectRes = await client.callTool({
      name: "superfyy_connect_entities",
      arguments: {
        project_id: projectId,
        source_id: nodeBId,
        target_id: nodeAId,
        relation_type: "DEPENDS_ON",
        weight: 1.0
      }
    });
    assert.equal(connectRes.isError, undefined);

    // Impact analysis on nodeAId (SecurityGateway)
    // nodeBId depends on nodeAId -> nodeBId is upstream of nodeAId
    const impactRes = await client.callTool({
      name: "superfyy_impact_analysis",
      arguments: {
        project_id: projectId,
        entity_id: nodeAId
      }
    });
    assert.equal(impactRes.isError, undefined);
    const impact = parseRes(impactRes);
    assert.equal(impact.upstream.length, 1);
    assert.equal(impact.upstream[0].id, nodeBId);
  });

  let taskId = "";
  await t.test("MCP Tools: Task Management, Artifacts, and Handover", async () => {
    const taskRes = await client.callTool({
      name: "superfyy_create_task",
      arguments: {
        project_id: projectId,
        title: "Harden Security Gateway",
        description: "Add IP blacklisting and brute force protection",
        priority: "CRITICAL",
        assigned_agent: "security-auditor"
      }
    });
    assert.equal(taskRes.isError, undefined);
    const task = parseRes(taskRes);
    taskId = task.id;

    // Add artifact
    const artRes = await client.callTool({
      name: "superfyy_add_task_artifact",
      arguments: {
        project_id: projectId,
        task_id: taskId,
        artifact_type: "SECURITY_REPORT",
        path_or_uri: "reports/sec_audit.md"
      }
    });
    assert.equal(artRes.isError, undefined);

    // Get Handover
    const handoverRes = await client.callTool({
      name: "superfyy_get_task_handover",
      arguments: {
        project_id: projectId,
        task_id: taskId
      }
    });
    assert.equal(handoverRes.isError, undefined);
    const text = getRawText(handoverRes);
    assert.match(text, /Harden Security Gateway/);
    assert.match(text, /reports\/sec_audit\.md/);
  });

  await t.test("MCP Tools: Resource Locks & Activities", async () => {
    const lockUri = "file:///src/security/gateway.ts";

    // Acquire lock
    const lockRes = await client.callTool({
      name: "superfyy_acquire_lock",
      arguments: {
        project_id: projectId,
        resource_uri: lockUri,
        agent_id: "security-auditor",
        ttl_seconds: 60
      }
    });
    assert.equal(parseRes(lockRes).success, true);

    // Another agent conflict
    const conflictRes = await client.callTool({
      name: "superfyy_acquire_lock",
      arguments: {
        project_id: projectId,
        resource_uri: lockUri,
        agent_id: "backend-dev"
      }
    });
    assert.equal(parseRes(conflictRes).success, false);

    // Release lock
    const relRes = await client.callTool({
      name: "superfyy_release_lock",
      arguments: {
        project_id: projectId,
        resource_uri: lockUri,
        agent_id: "security-auditor"
      }
    });
    assert.equal(parseRes(relRes).success, true);
  });

  await t.test("MCP Tool: superfyy_get_spherical_graph", async () => {
    const graphRes = await client.callTool({
      name: "superfyy_get_spherical_graph",
      arguments: {
        project_id: projectId,
        sphere_radius: 500
      }
    });
    assert.equal(graphRes.isError, undefined);
    const graph = parseRes(graphRes);
    assert.ok(graph.nodes.length >= 2);
    assert.ok(graph.links.length >= 1);
  });

  await t.test("MCP Resources: Read profiles and project list", async () => {
    // List resources
    const listRes = await client.listResources();
    assert.ok(listRes.resources.length >= 2);

    // Read profiles
    const profRes = await client.readResource({ uri: "superfyy://agents/profiles" });
    const profiles = JSON.parse((profRes.contents[0] as any).text);
    assert.ok(profiles.length >= 10);
    assert.equal(profiles[0].id, "coordinator");

    // Read projects
    const pListRes = await client.readResource({ uri: "superfyy://projects/list" });
    const pList = JSON.parse((pListRes.contents[0] as any).text);
    assert.equal(pList.length, 1);
  });

  await t.test("MCP Prompts: Get handover prompt & impact prompt", async () => {
    // Handover prompt
    const promptRes = await client.getPrompt({
      name: "superfyy_handover_prompt",
      arguments: {
        project_id: projectId,
        task_id: taskId
      }
    });
    assert.ok(promptRes.messages.length > 0);
    assert.match((promptRes.messages[0].content as any).text, /Harden Security Gateway/);

    // Impact prompt
    const impactPrompt = await client.getPrompt({
      name: "superfyy_impact_review_prompt",
      arguments: {
        project_id: projectId,
        entity_id: nodeAId
      }
    });
    assert.ok(impactPrompt.messages.length > 0);
    assert.match((impactPrompt.messages[0].content as any).text, /CRITICAL IMPACT AUDIT/);
  });
});
