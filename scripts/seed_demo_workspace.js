import path from "node:path";
import { ProjectRegistry } from "../dist/core/registry/project_registry.js";
import { ProjectMemory } from "../dist/core/memory/project_memory.js";
import { GraphEngine } from "../dist/core/graph/graph_engine.js";
import { TaskManager } from "../dist/core/tasks/task_manager.js";

/**
 * SUPER FYY — Synthetic Demo Project Seeder
 * 
 * Demonstrates:
 * - Multi-tier project registration
 * - Isolated memory database initialization
 * - Knowledge Graph node and relationship population
 * - Task DAG lifecycle and handover capsule creation
 * 
 * NOTE: All data herein is 100% synthetic and generated for demonstration purposes.
 */

async function seedDemo() {
  const demoPath = path.resolve(process.cwd(), "demo/quantum_flow");
  const registry = new ProjectRegistry();
  
  const existing = registry.getProject("proj_demo_quantum") || registry.getProjectByPath(demoPath);
  const project = existing || registry.registerProject({
    id: "proj_demo_quantum",
    name: "QuantumFlow Engine",
    canonicalPath: demoPath,
    technology: "TypeScript / Node.js",
    activeBranch: "main"
  });

  console.log(`[SYNTHETIC DEMO] Registered project: ${project.name} (${project.id})`);

  const memory = new ProjectMemory(project.memory_db_path, project.id);
  const graph = new GraphEngine(memory);
  const tasks = new TaskManager(memory.getRawDb(), project.id);

  // Check if graph already seeded
  const currentGraph = graph.exportSphericalGraph({});
  if (currentGraph.nodes && currentGraph.nodes.length > 0) {
    console.log(`[SYNTHETIC DEMO] Graph already seeded with ${currentGraph.nodes.length} nodes.`);
    return;
  }

  // 1. Root & Core Architecture Nodes
  const rootNode = graph.addEntity({
    entityType: "PROJECT_ROOT",
    name: "QuantumFlow Root",
    filePath: "",
    summary: "Root anchor of QuantumFlow Engine workspace"
  });

  const apiGateway = graph.addEntity({
    entityType: "MODULE",
    name: "gateway.ts",
    filePath: "app/gateway.ts",
    summary: "HTTP & WebSocket API Gateway with JWT validation and rate limiting"
  });

  const orchestrator = graph.addEntity({
    entityType: "SERVICE",
    name: "orchestrator.ts",
    filePath: "core/orchestrator.ts",
    summary: "DAG task scheduling engine with distributed lock coordination"
  });

  const dataRepository = graph.addEntity({
    entityType: "MODULE",
    name: "event_service.ts",
    filePath: "services/event_service.ts",
    summary: "Event sourcing persistence layer with transactional consistency"
  });

  const schemaTable = graph.addEntity({
    entityType: "DATABASE_TABLE",
    name: "workflow_events",
    filePath: "database/schema.sql",
    summary: "Immutable event store table with partition key and payload"
  });

  const docNode = graph.addEntity({
    entityType: "DOCUMENT",
    name: "api_spec.md",
    filePath: "docs/api_spec.md",
    summary: "API specification and endpoint contracts"
  });

  const e2eTest = graph.addEntity({
    entityType: "TEST",
    name: "gateway.test.ts",
    filePath: "tests/gateway.test.ts",
    summary: "Integration tests for gateway initialization"
  });

  // 2. Structural & Functional Edges
  graph.connectEntities({ sourceId: rootNode.id, targetId: apiGateway.id, relationType: "CONTAINS" });
  graph.connectEntities({ sourceId: rootNode.id, targetId: orchestrator.id, relationType: "CONTAINS" });
  graph.connectEntities({ sourceId: rootNode.id, targetId: dataRepository.id, relationType: "CONTAINS" });
  graph.connectEntities({ sourceId: rootNode.id, targetId: schemaTable.id, relationType: "CONTAINS" });
  graph.connectEntities({ sourceId: rootNode.id, targetId: docNode.id, relationType: "CONTAINS" });
  graph.connectEntities({ sourceId: rootNode.id, targetId: e2eTest.id, relationType: "CONTAINS" });

  graph.connectEntities({ sourceId: apiGateway.id, targetId: orchestrator.id, relationType: "DISPATCHES" });
  graph.connectEntities({ sourceId: orchestrator.id, targetId: dataRepository.id, relationType: "WRITES_TO" });
  graph.connectEntities({ sourceId: dataRepository.id, targetId: schemaTable.id, relationType: "MAPPED_TO" });
  graph.connectEntities({ sourceId: e2eTest.id, targetId: apiGateway.id, relationType: "VERIFIES" });

  console.log(`[SYNTHETIC DEMO] Graph constructed: 7 nodes, 10 edges.`);

  // 3. Task Management & Handover Capsule
  const task1 = tasks.createTask({
    title: "Implement Event Sourcing Persistence",
    description: "Build robust transactional event repository with SQLite backpressure handling.",
    agentRole: "BACKEND_ENGINEER"
  });
  tasks.updateTaskStatus(task1.id, "COMPLETED");

  const task2 = tasks.createTask({
    title: "Build 3D Cluster Visualizer",
    description: "Render high-density knowledge graph using spherical cluster layout.",
    agentRole: "FRONTEND_ENGINEER"
  });
  tasks.addDependency(task2.id, task1.id);
  tasks.updateTaskStatus(task2.id, "IN_PROGRESS");

  console.log(`[SYNTHETIC DEMO] Tasks created: ${task1.id} (COMPLETED), ${task2.id} (IN_PROGRESS)`);
  console.log(`[SYNTHETIC DEMO] Seeding completed successfully for ${project.id}.`);
}

seedDemo().catch(err => {
  console.error("[SYNTHETIC DEMO ERROR]", err);
  process.exit(1);
});
