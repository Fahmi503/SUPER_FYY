import { ProjectMemory, GraphNode, GraphEdge, EntityType, RelationType } from "../memory/project_memory.js";

export interface SphericalNode {
  id: string;
  name: string;
  type: EntityType;
  group: number;
  val: number; // Node weight/radius based on centrality
  filePath?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown>;
  initialPos?: { x: number; y: number; z: number };
}

export interface SphericalEdge {
  id: string;
  source: string;
  target: string;
  type: RelationType;
  weight: number;
}

export interface SphericalGraphData {
  nodes: SphericalNode[];
  links: SphericalEdge[];
}

export class GraphEngine {
  private memory: ProjectMemory;

  constructor(memory: ProjectMemory) {
    this.memory = memory;
  }

  // --- Entity & Edge Shortcuts ---

  public addEntity(params: {
    id?: string;
    entityType: EntityType;
    name: string;
    filePath?: string;
    summary?: string;
    fullContent?: string;
    metadata?: Record<string, unknown>;
  }): GraphNode {
    return this.memory.addNode(params);
  }

  public connectEntities(params: {
    id?: string;
    sourceId: string;
    targetId: string;
    relationType: RelationType;
    weight?: number;
    metadata?: Record<string, unknown>;
  }): GraphEdge {
    return this.memory.addEdge(params);
  }

  // --- Subgraph Extraction & Impact Analysis ---

  /**
   * Computes transitive impact analysis (upstream and downstream dependencies).
   * Useful when modifying a file, function, or table to see affected system parts.
   */
  public getImpactAnalysis(
    startNodeId: string,
    maxDepth: number = 5
  ): {
    upstream: GraphNode[]; // Things that depend on this node
    downstream: GraphNode[]; // Things this node depends on
    allNodes: GraphNode[];
    edges: GraphEdge[];
  } {
    const startNode = this.memory.getNode(startNodeId);
    if (!startNode) throw new Error(`Node not found: ${startNodeId}`);

    const upstreamIds = new Set<string>();
    const downstreamIds = new Set<string>();
    const traversedEdges: GraphEdge[] = [];

    // Traverse downstream (outgoing dependencies)
    const queueDown: { id: string; depth: number }[] = [{ id: startNodeId, depth: 0 }];
    while (queueDown.length > 0) {
      const { id, depth } = queueDown.shift()!;
      if (depth >= maxDepth) continue;

      const neighbors = this.memory.getNeighbors(id, "out");
      for (const { node, edge } of neighbors) {
        traversedEdges.push(edge);
        if (!downstreamIds.has(node.id) && node.id !== startNodeId) {
          downstreamIds.add(node.id);
          queueDown.push({ id: node.id, depth: depth + 1 });
        }
      }
    }

    // Traverse upstream (incoming dependents)
    const queueUp: { id: string; depth: number }[] = [{ id: startNodeId, depth: 0 }];
    while (queueUp.length > 0) {
      const { id, depth } = queueUp.shift()!;
      if (depth >= maxDepth) continue;

      const neighbors = this.memory.getNeighbors(id, "in");
      for (const { node, edge } of neighbors) {
        traversedEdges.push(edge);
        if (!upstreamIds.has(node.id) && node.id !== startNodeId) {
          upstreamIds.add(node.id);
          queueUp.push({ id: node.id, depth: depth + 1 });
        }
      }
    }

    const upstreamNodes: GraphNode[] = [];
    for (const uid of upstreamIds) {
      const n = this.memory.getNode(uid);
      if (n) upstreamNodes.push(n);
    }

    const downstreamNodes: GraphNode[] = [];
    for (const did of downstreamIds) {
      const n = this.memory.getNode(did);
      if (n) downstreamNodes.push(n);
    }

    const allNodeMap = new Map<string, GraphNode>();
    allNodeMap.set(startNode.id, startNode);
    for (const n of upstreamNodes) allNodeMap.set(n.id, n);
    for (const n of downstreamNodes) allNodeMap.set(n.id, n);

    // Deduplicate edges
    const uniqueEdges = Array.from(
      new Map(traversedEdges.map(e => [e.id, e])).values()
    );

    return {
      upstream: upstreamNodes,
      downstream: downstreamNodes,
      allNodes: Array.from(allNodeMap.values()),
      edges: uniqueEdges
    };
  }

  /**
   * BFS Shortest Path between two nodes.
   */
  public findShortestPath(sourceId: string, targetId: string): string[] | null {
    if (sourceId === targetId) return [sourceId];

    const visited = new Set<string>();
    const queue: { id: string; path: string[] }[] = [{ id: sourceId, path: [sourceId] }];

    while (queue.length > 0) {
      const { id, path } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);

      const neighbors = this.memory.getNeighbors(id, "out");
      for (const { node } of neighbors) {
        if (node.id === targetId) {
          return [...path, targetId];
        }
        if (!visited.has(node.id)) {
          queue.push({ id: node.id, path: [...path, node.id] });
        }
      }
    }

    return null;
  }

  // --- 3D Spherical Graph Formatting ---

  /**
   * Maps 15 entity types to numbered cluster groups for color encoding in 3D visualization.
   */
  public static getEntityTypeGroup(type: EntityType): number {
    const mapping: Record<EntityType, number> = {
      FILE: 1,
      FOLDER: 2,
      MODULE: 3,
      CLASS: 4,
      FUNCTION: 5,
      API_ENDPOINT: 6,
      DATABASE_TABLE: 7,
      TASK: 8,
      ISSUE: 9,
      DECISION: 10,
      DOCUMENT: 11,
      TEST: 12,
      AGENT: 13,
      COMMUNITY: 14,
      GIT_COMMIT: 15,
      UNKNOWN: 16
    };
    return mapping[type] || 0;
  }

  /**
   * Generates graph payload formatted specifically for 3D Spherical Force-Directed Graph.
   * Computes degree centrality (val) and assigns initial Fibonacci sphere surface coordinates.
   */
  public exportSphericalGraph(filter: {
    limit?: number;
    entityTypes?: EntityType[];
    sphereRadius?: number;
    viewMode?: "OVERVIEW" | "FULL" | "FOLDERS" | "DATABASE" | "TASKS";
    focusPath?: string;
  } = {}): SphericalGraphData {
    let effectiveEntityTypes = filter.entityTypes;

    if (!effectiveEntityTypes && filter.viewMode) {
      if (filter.viewMode === "OVERVIEW") {
        effectiveEntityTypes = ["FOLDER", "MODULE", "DATABASE_TABLE", "TASK", "AGENT", "DECISION"];
      } else if (filter.viewMode === "DATABASE") {
        effectiveEntityTypes = ["DATABASE_TABLE", "MODULE"];
      } else if (filter.viewMode === "TASKS") {
        effectiveEntityTypes = ["TASK", "AGENT", "DECISION", "TEST", "DOCUMENT"];
      } else if (filter.viewMode === "FOLDERS") {
        effectiveEntityTypes = ["FOLDER", "FILE", "MODULE"];
      }
    }

    const raw = this.memory.getGraph({
      limit: filter.limit,
      entityTypes: effectiveEntityTypes
    });

    let rawNodes = raw.nodes;
    if (filter.focusPath) {
      const normalizedFocus = filter.focusPath.replace(/\\/g, "/").toLowerCase();
      rawNodes = rawNodes.filter(n => {
        if (!n.file_path) return false;
        return n.file_path.replace(/\\/g, "/").toLowerCase().startsWith(normalizedFocus);
      });
    }

    const radius = filter.sphereRadius || 300;
    const nodeIds = new Set(rawNodes.map(n => n.id));
    const rawEdges = raw.edges.filter(e => nodeIds.has(e.source_id) && nodeIds.has(e.target_id));

    // Calculate degree centrality per node
    const degreeMap = new Map<string, number>();
    for (const n of rawNodes) {
      degreeMap.set(n.id, 0);
    }
    for (const e of rawEdges) {
      degreeMap.set(e.source_id, (degreeMap.get(e.source_id) || 0) + 1);
      degreeMap.set(e.target_id, (degreeMap.get(e.target_id) || 0) + 1);
    }

    // Fibonacci sphere distribution for harmonious 3D initial placement
    const numNodes = rawNodes.length;
    const phi = Math.PI * (Math.sqrt(5) - 1); // Golden angle

    const nodes: SphericalNode[] = rawNodes.map((n, i) => {
      const degree = degreeMap.get(n.id) || 0;
      const val = Math.max(2, Math.min(25, 3 + degree * 1.5));

      // 3D coordinates on sphere
      const y = numNodes > 1 ? 1 - (i / (numNodes - 1)) * 2 : 0;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = phi * i;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;

      let meta: Record<string, unknown> = {};
      try {
        meta = JSON.parse(n.metadata_json || "{}");
      } catch {}

      return {
        id: n.id,
        name: n.name,
        type: n.entity_type,
        group: GraphEngine.getEntityTypeGroup(n.entity_type),
        val,
        filePath: n.file_path,
        summary: n.summary,
        metadata: meta,
        initialPos: {
          x: x * radius,
          y: y * radius,
          z: z * radius
        }
      };
    });

    const links: SphericalEdge[] = rawEdges.map(e => ({
      id: e.id,
      source: e.source_id,
      target: e.target_id,
      type: e.relation_type,
      weight: e.weight
    }));

    return { nodes, links };
  }
}
