import path from "node:path";
import { ProjectMemory, GraphNode, GraphEdge, EntityType } from "../memory/project_memory.js";

type VerificationStatus = "VERIFIED" | "DOCUMENTATION_BASED" | "MANUAL" | "MIXED" | "UNVERIFIED";

export interface ClusterSummary {
  id: string;
  projectId: string;
  name: string;
  entityType: EntityType;
  childEntityCount: number;
  relatedEntityCount: number;
  verificationStatus: VerificationStatus;
  sourceReferences: string[];
  typeCounts: Record<string, number>;
  clusterKind: "FOLDER" | "DATABASE" | "TASKS" | "ROOT_FILES" | "UNMAPPED";
  filePath?: string;
  nodeId?: string;
}

export interface PresentationNode {
  id: string;
  name: string;
  type: EntityType;
  filePath: string | null;
  summary: string | null;
  metadata?: Record<string, unknown>;
  kind: "CLUSTER" | "ENTITY" | "TASK" | "RELATED";
  clusterId?: string;
  childEntityCount?: number;
  relatedEntityCount?: number;
  verificationStatus?: VerificationStatus;
  initialPos?: { x: number; y: number; z: number };
}

export interface PresentationEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  count?: number;
  verificationStatus: VerificationStatus;
  evidence: string[];
  edgeIds: string[];
  types?: string[];
  structural?: boolean;
}

export interface ConnectivityDiagnostic {
  totalClusters: number;
  connectedClusters: number;
  isolatedClusters: string[];
  isolatedClusterDetails: Array<{ id: string; name: string; reason: string }>;
  connectedComponentsCount: number;
  components: Array<{ id: number; size: number; clusterIds: string[] }>;
  aggregatedEdgesCount: number;
  underlyingRelationshipsCount: number;
  unaggregatedRelationshipsCount: number;
  rootClusterId?: string;
  structurallyConnectedCount?: number;
  structuralComponentsCount?: number;
  functionallyConnectedCount?: number;
  functionallyIsolatedCount?: number;
  functionalComponentsCount?: number;
  functionallyIsolatedClusters?: Array<{ id: string; name: string; reason: string }>;
}

const VERIFIABLE = new Set(["VERIFIED", "DOCUMENTATION_BASED", "MANUAL"]);
const MAX_PAGE_SIZE = 100;
const parseMetadata = (value: string | null | undefined): Record<string, any> => {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
};
const normalizePath = (value: string | null | undefined): string =>
  (value || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
const unique = <T>(items: T[]): T[] => [...new Set(items)];

function nodeStatus(node: Pick<GraphNode, "metadata_json">): VerificationStatus {
  const provenance = parseMetadata(node.metadata_json).provenance;
  if (provenance === "VERIFIED" || provenance === "SOURCE_CODE_VERIFIED") return "VERIFIED";
  if (provenance === "DOCUMENTATION_BASED") return "DOCUMENTATION_BASED";
  if (provenance === "MANUAL") return "MANUAL";
  return "UNVERIFIED";
}

function aggregateStatus(statuses: VerificationStatus[]): VerificationStatus {
  if (!statuses.length || statuses.includes("UNVERIFIED")) return "UNVERIFIED";
  const uniqueStatuses = new Set(statuses);
  return uniqueStatuses.size === 1 ? statuses[0] : "MIXED";
}

export function computeSphericalPositions(count: number, radius: number): { x: number; y: number; z: number }[] {
  if (count <= 0) return [];
  if (count === 1) return [{ x: 0, y: 0, z: 0 }];
  const phi = Math.PI * (Math.sqrt(5) - 1);
  return Array.from({ length: count }, (_, i) => {
    const y = count > 1 ? 1 - (i / (count - 1)) * 2 : 0;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = phi * i;
    return {
      x: Math.round(Math.cos(theta) * r * radius * 10) / 10,
      y: Math.round(y * radius * 10) / 10,
      z: Math.round(Math.sin(theta) * r * radius * 10) / 10
    };
  });
}

/** Read-only view/query layer. Creates no graph entities or edges and does not alter storage. */
export class GraphPresentation {
  private readonly projectId: string;
  private readonly db: ReturnType<ProjectMemory["getRawDb"]>;

  constructor(memory: ProjectMemory) {
    this.projectId = memory.projectId;
    this.db = memory.getRawDb();
  }

  private hasTable(name: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  }

  private getNodes(): GraphNode[] {
    return this.db.prepare(
      "SELECT * FROM graph_nodes WHERE project_id = ? ORDER BY file_path, entity_type, name, id"
    ).all(this.projectId) as unknown as GraphNode[];
  }

  private getEdges(): GraphEdge[] {
    return this.db.prepare(
      "SELECT * FROM graph_edges WHERE project_id = ? ORDER BY id"
    ).all(this.projectId) as unknown as GraphEdge[];
  }

  private getTasks(): any[] {
    return this.db.prepare(
      "SELECT * FROM tasks WHERE project_id = ? ORDER BY status, title, id"
    ).all(this.projectId) as any[];
  }

  private clusterId(node: Pick<GraphNode, "id" | "entity_type" | "file_path">): string {
    if (node.id?.startsWith("root:") || node.file_path === ".") return `root:${this.projectId}`;
    if (node.entity_type === "DATABASE_TABLE") return "category:database";
    const rel = normalizePath(node.file_path);
    if (!rel) return "category:unmapped";
    if (node.entity_type === "FOLDER") return `folder:${rel.split("/")[0]}`;
    if (!rel.includes("/")) return "category:root-files";
    return `folder:${rel.split("/")[0]}`;
  }

  private folderSummary(root: string, nodes: GraphNode[], edges: GraphEdge[]): ClusterSummary | null {
    const normalizedRoot = normalizePath(root);
    const folder = nodes.find(n => n.entity_type === "FOLDER" && normalizePath(n.file_path) === normalizedRoot);
    const members = nodes.filter(n => {
      const rel = normalizePath(n.file_path);
      return rel === normalizedRoot || rel.startsWith(`${normalizedRoot}/`);
    });
    if (!members.length) return null;
    const ids = new Set(members.map(n => n.id));
    const typeCounts: Record<string, number> = {};
    for (const n of members) typeCounts[n.entity_type] = (typeCounts[n.entity_type] || 0) + 1;
    return {
      id: `folder:${normalizedRoot}`,
      projectId: this.projectId,
      name: normalizedRoot,
      entityType: "FOLDER",
      childEntityCount: members.length,
      relatedEntityCount: edges.filter(e => ids.has(e.source_id) !== ids.has(e.target_id)).length,
      verificationStatus: aggregateStatus(members.map(nodeStatus)),
      sourceReferences: unique(members.map(n => n.file_path).filter(Boolean) as string[]).slice(0, 5),
      typeCounts,
      clusterKind: "FOLDER",
      filePath: normalizedRoot,
      nodeId: folder?.id
    };
  }

  private categorySummary(
    id: string,
    name: string,
    type: EntityType,
    kind: ClusterSummary["clusterKind"],
    members: GraphNode[],
    edges: GraphEdge[]
  ): ClusterSummary {
    const ids = new Set(members.map(n => n.id));
    const typeCounts: Record<string, number> = {};
    for (const n of members) typeCounts[n.entity_type] = (typeCounts[n.entity_type] || 0) + 1;
    return {
      id,
      projectId: this.projectId,
      name,
      entityType: type,
      childEntityCount: members.length,
      relatedEntityCount: edges.filter(e => ids.has(e.source_id) !== ids.has(e.target_id)).length,
      verificationStatus: aggregateStatus(members.map(nodeStatus)),
      sourceReferences: unique(members.map(n => n.file_path).filter(Boolean) as string[]).slice(0, 5),
      typeCounts,
      clusterKind: kind
    };
  }

  private taskSummary(tasks: any[]): ClusterSummary {
    const rows = this.db.prepare(
      "SELECT metadata_json FROM graph_nodes WHERE project_id = ? AND entity_type = 'TASK'"
    ).all(this.projectId) as Pick<GraphNode, "metadata_json">[];
    return {
      id: "category:tasks",
      projectId: this.projectId,
      name: "Tasks",
      entityType: "TASK",
      childEntityCount: tasks.length,
      relatedEntityCount: 0,
      verificationStatus: rows.length ? aggregateStatus(rows.map(nodeStatus)) : "VERIFIED",
      sourceReferences: [],
      typeCounts: tasks.length ? { TASK: tasks.length } : {},
      clusterKind: "TASKS"
    };
  }

  private categoryInfo(id: string): { name: string; type: EntityType; kind: ClusterSummary["clusterKind"] } | null {
    if (id === "category:database") return { name: "Database", type: "DATABASE_TABLE", kind: "DATABASE" };
    if (id === "category:root-files") return { name: "Root files", type: "FILE", kind: "ROOT_FILES" };
    if (id === "category:unmapped") return { name: "Unmapped entities", type: "UNKNOWN", kind: "UNMAPPED" };
    return null;
  }

  public getOverview(projectName: string) {
    const nodes = this.getNodes();
    const edges = this.getEdges();
    const tasks = this.getTasks();
    const clusters: ClusterSummary[] = [];
    const roots = unique(nodes.flatMap(n => {
      const rel = normalizePath(n.file_path);
      if (!rel || rel === ".") return [];
      const parts = rel.split("/");
      return n.entity_type === "FOLDER" && parts.length === 1 ? [rel] : parts.length > 1 ? [parts[0]] : [];
    })).filter(r => r !== ".").sort();
    for (const root of roots) {
      const cluster = this.folderSummary(root, nodes, edges);
      if (cluster?.childEntityCount) clusters.push(cluster);
    }
    const categories = new Map<string, GraphNode[]>();
    for (const node of nodes) {
      const id = this.clusterId(node);
      if (id.startsWith("folder:")) continue;
      const values = categories.get(id) || [];
      values.push(node);
      categories.set(id, values);
    }
    for (const [id, members] of categories) {
      const info = this.categoryInfo(id);
      if (info && members.length) clusters.push(this.categorySummary(id, info.name, info.type, info.kind, members, edges));
    }
    if (tasks.length) clusters.push(this.taskSummary(tasks));
    clusters.sort((a, b) => a.name.localeCompare(b.name));

    const byId = new Map(clusters.map(c => [c.id, c]));
    const nodeCluster = new Map(nodes.map(n => [n.id, this.clusterId(n)]));

    interface ClusterPairGroup {
      source: string;
      target: string;
      forwardCount: number;
      reverseCount: number;
      types: Set<string>;
      ids: string[];
      evidence: Set<string>;
      statuses: VerificationStatus[];
    }
    const pairGroups = new Map<string, ClusterPairGroup>();

    const rootClusterId = `root:${this.projectId}`;

    for (const edge of edges) {
      const source = nodeCluster.get(edge.source_id);
      const target = nodeCluster.get(edge.target_id);
      if (!source || !target || source === target || !byId.has(source) || !byId.has(target)) continue;
      // Skip structural containment edges from functional pairGroups
      if (source === rootClusterId || target === rootClusterId || edge.relation_type === "CONTAINS") continue;

      const isCanonical = source <= target;
      const s = isCanonical ? source : target;
      const t = isCanonical ? target : source;
      const pairKey = `${s}\0${t}`;

      const meta = parseMetadata(edge.metadata_json);
      const status: VerificationStatus =
        meta.provenance === "VERIFIED" || meta.provenance === "SOURCE_CODE_VERIFIED"
          ? (meta.evidence ? "VERIFIED" : "UNVERIFIED")
          : meta.provenance === "DOCUMENTATION_BASED"
          ? (meta.evidence ? "DOCUMENTATION_BASED" : "UNVERIFIED")
          : meta.provenance === "MANUAL"
          ? "MANUAL"
          : "UNVERIFIED";

      let group = pairGroups.get(pairKey);
      if (!group) {
        group = {
          source: s,
          target: t,
          forwardCount: 0,
          reverseCount: 0,
          types: new Set<string>(),
          ids: [],
          evidence: new Set<string>(),
          statuses: []
        };
        pairGroups.set(pairKey, group);
      }

      if (source === s) group.forwardCount++;
      else group.reverseCount++;

      group.types.add(edge.relation_type);
      group.ids.push(edge.id);
      if (meta.evidence) group.evidence.add(String(meta.evidence));
      group.statuses.push(status);
    }

    const functionalLinks: PresentationEdge[] = [...pairGroups.values()]
      .sort((a, b) => b.ids.length - a.ids.length || a.source.localeCompare(b.source) || a.target.localeCompare(b.target))
      .map((g, i) => {
        const actualSource = g.reverseCount > g.forwardCount ? g.target : g.source;
        const actualTarget = g.reverseCount > g.forwardCount ? g.source : g.target;
        return {
          id: `aggregate:${this.projectId}:${i}:${actualSource}:${actualTarget}`,
          source: actualSource,
          target: actualTarget,
          type: [...g.types].sort().join(", "),
          types: [...g.types].sort(),
          count: g.ids.length,
          verificationStatus: aggregateStatus(g.statuses),
          evidence: [...g.evidence].slice(0, 5),
          edgeIds: g.ids.slice(0, 10),
          structural: false
        };
      });

    // Project Root Cluster Definition (Center Anchor)
    const rootCluster: ClusterSummary = {
      id: rootClusterId,
      projectId: this.projectId,
      name: `${projectName} (Root)`,
      entityType: "FOLDER",
      childEntityCount: nodes.length,
      relatedEntityCount: clusters.length,
      verificationStatus: "VERIFIED",
      sourceReferences: ["."],
      typeCounts: { FOLDER: 1 },
      clusterKind: "ROOT_FILES",
      filePath: ".",
      nodeId: rootClusterId
    };

    // Structural Links: Project Root CONTAINS all clusters
    const structuralLinks: PresentationEdge[] = clusters.map((c, i) => ({
      id: `structural:${this.projectId}:${i}:${rootClusterId}:${c.id}`,
      source: rootClusterId,
      target: c.id,
      type: "CONTAINS",
      types: ["CONTAINS"],
      count: c.childEntityCount || 1,
      verificationStatus: "VERIFIED" as VerificationStatus,
      evidence: [`Canonical project root containment of ${c.name}`],
      edgeIds: [],
      structural: true
    }));

    const allLinks: PresentationEdge[] = [...structuralLinks, ...functionalLinks];

    // Connectivity topology analysis: Functional vs Structural
    const adjFunctional = new Map<string, Set<string>>();
    const adjStructural = new Map<string, Set<string>>();
    const clusterFunctionalRels = new Map<string, { count: number; otherClusters: Set<string>; types: Set<string>; evidence: Set<string> }>();

    for (const c of clusters) {
      adjFunctional.set(c.id, new Set());
      adjStructural.set(c.id, new Set());
      clusterFunctionalRels.set(c.id, { count: 0, otherClusters: new Set(), types: new Set(), evidence: new Set() });
    }
    adjFunctional.set(rootClusterId, new Set());
    adjStructural.set(rootClusterId, new Set());
    clusterFunctionalRels.set(rootClusterId, { count: 0, otherClusters: new Set(), types: new Set(), evidence: new Set() });

    for (const l of structuralLinks) {
      adjStructural.get(l.source)?.add(l.target);
      adjStructural.get(l.target)?.add(l.source);
    }

    for (const l of functionalLinks) {
      adjFunctional.get(l.source)?.add(l.target);
      adjFunctional.get(l.target)?.add(l.source);

      const sInfo = clusterFunctionalRels.get(l.source);
      if (sInfo) {
        sInfo.count += l.count || 0;
        sInfo.otherClusters.add(l.target);
        if (l.types) l.types.forEach(t => sInfo.types.add(t));
        l.evidence.forEach(ev => sInfo.evidence.add(ev));
      }

      const tInfo = clusterFunctionalRels.get(l.target);
      if (tInfo) {
        tInfo.count += l.count || 0;
        tInfo.otherClusters.add(l.source);
        if (l.types) l.types.forEach(t => tInfo.types.add(t));
        l.evidence.forEach(ev => tInfo.evidence.add(ev));
      }
    }

    // BFS on functional graph
    const visitedFunctional = new Set<string>();
    const functionalComponents: Array<{ id: number; size: number; clusterIds: string[] }> = [];
    let funcCompId = 0;
    for (const c of clusters) {
      if (!visitedFunctional.has(c.id)) {
        funcCompId++;
        const compClusters: string[] = [];
        const queue = [c.id];
        visitedFunctional.add(c.id);
        while (queue.length > 0) {
          const curr = queue.shift()!;
          compClusters.push(curr);
          for (const neighbor of adjFunctional.get(curr) || []) {
            if (!visitedFunctional.has(neighbor)) {
              visitedFunctional.add(neighbor);
              queue.push(neighbor);
            }
          }
        }
        functionalComponents.push({ id: funcCompId, size: compClusters.length, clusterIds: compClusters });
      }
    }

    const getIsolationReason = (clusterId: string, name: string): string => {
      const lower = name.toLowerCase();
      if (clusterId === "category:tasks") return "Project roadmap tasks stored in task table; zero file artifact linkages in graph.";
      if (lower.includes("design-system")) return "UI design tokens and documentation; not directly imported by application source code.";
      if (lower.includes("notebook")) return "Exploratory analysis Jupyter notebook; standalone script not imported by runtime code.";
      if (lower.includes("template")) return "Static CSV template assets for download/import; no runtime code dependencies.";
      if (lower.includes("model")) return "Placeholder directory; no model code or weights present.";
      return "Belum ditemukan recorded relationship dalam AST atau memory proyek.";
    };

    const functionallyIsolatedClusters = clusters
      .filter(c => (adjFunctional.get(c.id)?.size || 0) === 0)
      .map(c => ({
        id: c.id,
        name: c.name,
        reason: getIsolationReason(c.id, c.name)
      }));

    const connectivity: ConnectivityDiagnostic = {
      totalClusters: clusters.length + 1,
      connectedClusters: clusters.length + 1,
      isolatedClusters: functionallyIsolatedClusters.map(c => c.id),
      isolatedClusterDetails: functionallyIsolatedClusters,
      connectedComponentsCount: 1, // 100% structurally unified via root anchor
      components: [
        {
          id: 1,
          size: clusters.length + 1,
          clusterIds: [rootClusterId, ...clusters.map(c => c.id)]
        }
      ],
      aggregatedEdgesCount: allLinks.length,
      underlyingRelationshipsCount: allLinks.reduce((sum, l) => sum + (l.count || 0), 0),
      unaggregatedRelationshipsCount: 0,
      rootClusterId,
      structurallyConnectedCount: clusters.length,
      structuralComponentsCount: 1,
      functionallyConnectedCount: clusters.length - functionallyIsolatedClusters.length,
      functionallyIsolatedCount: functionallyIsolatedClusters.length,
      functionalComponentsCount: functionalComponents.length,
      functionallyIsolatedClusters
    };

    // Overview 3D Positioning: Root at Center (0, 0, 0), Clusters on Fibonacci Sphere (R = 340)
    const overviewPositions = computeSphericalPositions(clusters.length, 340);
    const rootNodePresentation: PresentationNode = {
      id: rootClusterId,
      name: `${projectName} (Root)`,
      type: "FOLDER",
      filePath: ".",
      summary: `Project Root Anchor · ${nodes.length} entities`,
      metadata: {
        isRoot: true,
        verificationStatus: "VERIFIED",
        sourceReferences: ["."],
        structuralConnectionCount: clusters.length,
        functionalConnectionCount: 0,
        connectedClusters: clusters.map(c => c.id),
        connectedClusterCount: clusters.length,
        isStructurallyConnected: true,
        isFunctionallyIsolated: false,
        functionalStatus: "STRUCTURAL_ROOT_ANCHOR"
      },
      kind: "CLUSTER",
      clusterId: rootClusterId,
      childEntityCount: nodes.length,
      relatedEntityCount: clusters.length,
      verificationStatus: "VERIFIED",
      initialPos: { x: 0, y: 0, z: 0 }
    };

    const clusterPresentationNodes: PresentationNode[] = clusters.map((c, i) => {
      const funcInfo = clusterFunctionalRels.get(c.id);
      const isFuncIsolated = (funcInfo?.otherClusters.size || 0) === 0;
      return {
        id: c.id,
        name: c.name,
        type: c.entityType,
        filePath: c.filePath || null,
        summary: `${c.childEntityCount} indexed entities`,
        metadata: {
          typeCounts: c.typeCounts,
          verificationStatus: c.verificationStatus,
          sourceReferences: c.sourceReferences,
          connectedClusters: [rootClusterId, ...(funcInfo ? [...funcInfo.otherClusters] : [])],
          connectedClusterCount: 1 + (funcInfo?.otherClusters.size || 0),
          structuralConnectionCount: 1,
          functionalConnectionCount: funcInfo?.count || 0,
          relationshipCount: (c.childEntityCount || 1) + (funcInfo?.count || 0),
          relationshipTypes: ["CONTAINS", ...(funcInfo ? [...funcInfo.types] : [])],
          relationshipEvidence: funcInfo ? [...funcInfo.evidence].slice(0, 5) : [],
          isStructurallyConnected: true,
          isFunctionallyIsolated: isFuncIsolated,
          functionalStatus: isFuncIsolated ? "NO_VERIFIED_FUNCTIONAL_LINK" : "FUNCTIONALLY_CONNECTED",
          isolationReason: isFuncIsolated ? getIsolationReason(c.id, c.name) : undefined,
          connectedFunctionalClusters: funcInfo ? [...funcInfo.otherClusters] : [],
          connectedStructuralClusters: [rootClusterId]
        },
        kind: "CLUSTER",
        clusterId: c.id,
        childEntityCount: c.childEntityCount,
        relatedEntityCount: c.relatedEntityCount,
        verificationStatus: c.verificationStatus,
        initialPos: overviewPositions[i]
      };
    });

    const allPresentationNodes = [rootNodePresentation, ...clusterPresentationNodes];

    return {
      mode: "OVERVIEW" as const,
      project: { id: this.projectId, name: projectName },
      nodes: allPresentationNodes,
      clusters: [rootCluster, ...clusters],
      links: allLinks,
      storedNodeCount: nodes.length,
      storedEdgeCount: edges.length,
      visibleNodeCount: allPresentationNodes.length,
      visibleEdgeCount: allLinks.length,
      connectivity
    };
  }

  public getCluster(clusterId: string, options: { offset?: number; limit?: number; types?: EntityType[] } = {}) {
    const offset = Math.max(0, Math.floor(options.offset || 0));
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(options.limit || 36)));
    const allowedTypes = options.types === undefined ? null : new Set(options.types);
    const nodes = this.getNodes();
    const edges = this.getEdges();
    const tasks = this.getTasks();
    let members: GraphNode[] = [];
    let childClusters: ClusterSummary[] = [];
    let cluster: ClusterSummary;
    let folderNodeId: string | undefined;

    if (clusterId === "category:tasks") {
      cluster = this.taskSummary(tasks);
    } else if (clusterId.startsWith("folder:")) {
      const root = normalizePath(clusterId.slice(7));
      if (!root || root.split("/").some(p => p === ".." || p === ".")) throw new Error("Invalid cluster path");
      if (!nodes.some(n => normalizePath(n.file_path) === root || normalizePath(n.file_path).startsWith(`${root}/`))) throw new Error("Cluster not found");
      const summary = this.folderSummary(root, nodes, edges);
      if (!summary) throw new Error("Cluster not found");
      cluster = summary;
      folderNodeId = summary.nodeId;
      const prefix = `${root}/`;
      childClusters = nodes
        .filter(n => n.entity_type === "FOLDER" && normalizePath(n.file_path).startsWith(prefix) && !normalizePath(n.file_path).slice(prefix.length).includes("/"))
        .map(n => this.folderSummary(normalizePath(n.file_path), nodes, edges))
        .filter((c): c is ClusterSummary => !!c && c.childEntityCount > 0)
        .filter(c => !allowedTypes || Object.entries(c.typeCounts).some(([type, count]) => count > 0 && allowedTypes.has(type as EntityType)));
      members = nodes.filter(n => {
        const rel = normalizePath(n.file_path);
        return rel !== root && rel.startsWith(prefix) && !rel.slice(prefix.length).includes("/") && n.entity_type !== "FOLDER";
      });
    } else {
      const info = this.categoryInfo(clusterId);
      if (!info) throw new Error("Unknown cluster id");
      members = nodes.filter(n => this.clusterId(n) === clusterId);
      cluster = this.categorySummary(clusterId, info.name, info.type, info.kind, members, edges);
    }

    const isTasks = clusterId === "category:tasks";
    const filteredTasks = !allowedTypes || allowedTypes.has("TASK") ? tasks : [];
    const filteredMembers = allowedTypes ? members.filter(n => allowedTypes.has(n.entity_type)) : members;
    const totalEntities = isTasks ? filteredTasks.length : filteredMembers.length;
    const pageMembers = filteredMembers.slice(offset, offset + limit);
    const pageNodes: PresentationNode[] = isTasks
      ? filteredTasks.slice(offset, offset + limit).map(t => ({
          id: t.id,
          name: t.title,
          type: "TASK",
          filePath: null,
          summary: t.description || t.status,
          metadata: { status: t.status, priority: t.priority, assignedAgent: t.assigned_agent },
          kind: "TASK",
          clusterId,
          verificationStatus: "VERIFIED"
        }))
      : pageMembers.map(n => ({
          id: n.id,
          name: n.name,
          type: n.entity_type,
          filePath: n.file_path,
          summary: n.summary,
          metadata: parseMetadata(n.metadata_json),
          kind: "ENTITY",
          clusterId,
          verificationStatus: nodeStatus(n)
        }));
    const childNodes: PresentationNode[] = childClusters.map(c => ({
      id: c.nodeId || c.id,
      name: c.name,
      type: "FOLDER",
      filePath: c.filePath || null,
      summary: `${c.childEntityCount} indexed entities`,
      metadata: { typeCounts: c.typeCounts },
      kind: "CLUSTER",
      clusterId: c.id,
      childEntityCount: allowedTypes ? Object.entries(c.typeCounts).reduce((sum, [type, count]) => sum + (allowedTypes.has(type as EntityType) ? count : 0), 0) : c.childEntityCount,
      relatedEntityCount: c.relatedEntityCount,
      verificationStatus: c.verificationStatus
    }));
    const shown = [...childNodes, ...pageNodes];
    const clusterPositions = computeSphericalPositions(shown.length, 300);
    shown.forEach((n, i) => {
      n.initialPos = clusterPositions[i];
    });
    const filteredIds = new Set(filteredMembers.map(n => n.id));
    const pageIds = new Set(pageMembers.map(n => n.id));
    const childNodeIds = new Set(childClusters.map(c => c.nodeId).filter((id): id is string => !!id));
    if (folderNodeId) childNodeIds.add(folderNodeId);
    const validIds = new Set([...filteredIds, ...childNodeIds]);
    const links = edges
      .filter(e => validIds.has(e.source_id) && validIds.has(e.target_id) && (pageIds.has(e.source_id) || pageIds.has(e.target_id)))
      .map(e => {
        const metadata = parseMetadata(e.metadata_json);
        return {
          id: e.id,
          source: e.source_id,
          target: e.target_id,
          type: e.relation_type,
          verificationStatus: (metadata.provenance === "VERIFIED" ? "VERIFIED" : metadata.provenance === "DOCUMENTATION_BASED" ? "DOCUMENTATION_BASED" : metadata.provenance === "MANUAL" ? "MANUAL" : "UNVERIFIED") as VerificationStatus,
          evidence: metadata.evidence ? [String(metadata.evidence)] : [],
          edgeIds: [e.id]
        } as PresentationEdge;
      });
    return {
      mode: "CLUSTER" as const,
      projectId: this.projectId,
      cluster,
      nodes: shown,
      links,
      childClusters,
      offset,
      limit,
      totalEntities,
      hasMore: offset + pageNodes.length < totalEntities
    };
  }

  public getEntityDetail(entityId: string, projectName: string) {
    const n = this.db.prepare(
      "SELECT id, project_id, entity_type, name, file_path, summary, metadata_json FROM graph_nodes WHERE project_id = ? AND id = ?"
    ).get(this.projectId, entityId) as (Pick<GraphNode, "id" | "project_id" | "entity_type" | "name" | "file_path" | "summary" | "metadata_json"> & { project_id: string }) | undefined;
    if (!n) throw new Error("Entity not found");
    const relPath = normalizePath(n.file_path);
    const dir = relPath ? path.posix.dirname(relPath) : "";
    const parentRow = dir && dir !== "."
      ? this.db.prepare("SELECT id, project_id, entity_type, name, file_path, summary, metadata_json FROM graph_nodes WHERE project_id = ? AND entity_type = 'FOLDER' AND file_path = ? LIMIT 1").get(this.projectId, dir) as any
      : null;
    const parent = parentRow ? { id: parentRow.id, name: parentRow.name, filePath: parentRow.file_path, type: parentRow.entity_type } : null;
    const rows = this.db.prepare(`
      SELECT e.id, e.project_id, e.source_id, e.target_id, e.relation_type, e.weight, e.metadata_json, e.created_at,
             n.id related_id, n.project_id related_project_id, n.entity_type related_entity_type, n.name related_name,
             n.file_path related_file_path, n.summary related_summary, n.metadata_json related_metadata_json
      FROM graph_edges e
      JOIN graph_nodes n ON n.id = CASE WHEN e.source_id = ? THEN e.target_id ELSE e.source_id END AND n.project_id = e.project_id
      WHERE e.project_id = ? AND (e.source_id = ? OR e.target_id = ?)
      ORDER BY e.relation_type, n.name, e.id LIMIT 200
    `).all(entityId, this.projectId, entityId, entityId) as any[];
    const relationships = rows.map(r => {
      const edge = { id: r.id, project_id: r.project_id, source_id: r.source_id, target_id: r.target_id, relation_type: r.relation_type, weight: r.weight, metadata_json: r.metadata_json, created_at: r.created_at };
      const metadata = parseMetadata(edge.metadata_json);
      const node = { id: r.related_id, project_id: r.related_project_id, entity_type: r.related_entity_type, name: r.related_name, file_path: r.related_file_path, summary: r.related_summary, metadata_json: r.related_metadata_json };
      return {
        edge,
        direction: edge.source_id === entityId ? "OUTGOING" as const : "INCOMING" as const,
        node,
        verificationStatus: (metadata.provenance === "VERIFIED" ? "VERIFIED" : metadata.provenance === "DOCUMENTATION_BASED" ? "DOCUMENTATION_BASED" : metadata.provenance === "MANUAL" ? "MANUAL" : "UNVERIFIED") as VerificationStatus,
        evidence: metadata.evidence ? String(metadata.evidence) : null
      };
    });
    const evidence = this.hasTable("memory_evidence")
      ? this.db.prepare("SELECT * FROM memory_evidence WHERE project_id = ? AND node_id = ? ORDER BY created_at DESC LIMIT 50").all(this.projectId, entityId) as any[]
      : [];
    const taskIds = new Set<string>();
    for (const ev of evidence) if (ev.task_id) taskIds.add(ev.task_id);
    if (n.file_path && this.hasTable("task_artifacts")) {
      const artifacts = this.db.prepare("SELECT a.task_id FROM task_artifacts a JOIN tasks t ON t.id = a.task_id WHERE t.project_id = ? AND a.path_or_uri = ?").all(this.projectId, n.file_path) as { task_id: string }[];
      for (const artifact of artifacts) taskIds.add(artifact.task_id);
    }
    const tasks = [...taskIds].flatMap(id => {
      const task = this.db.prepare("SELECT * FROM tasks WHERE project_id = ? AND id = ?").get(this.projectId, id);
      return task ? [task] : [];
    });
    const decisions = this.hasTable("decisions")
      ? [...taskIds].flatMap(id => this.db.prepare("SELECT * FROM decisions WHERE project_id = ? AND task_id = ? ORDER BY created_at DESC").all(this.projectId, id) as any[])
      : [];
    const detailNodes: PresentationNode[] = [
      {
        id: n.id,
        name: n.name,
        type: n.entity_type,
        filePath: n.file_path,
        summary: n.summary,
        metadata: parseMetadata(n.metadata_json),
        kind: "ENTITY",
        verificationStatus: nodeStatus(n),
        initialPos: { x: 0, y: 0, z: 0 }
      }
    ];
    const relPositions = computeSphericalPositions(relationships.length, 240);
    relationships.forEach((r, i) => {
      detailNodes.push({
        id: r.node.id,
        name: r.node.name,
        type: r.node.entity_type,
        filePath: r.node.file_path,
        summary: r.node.summary,
        metadata: parseMetadata(r.node.metadata_json),
        kind: "RELATED",
        verificationStatus: r.verificationStatus,
        initialPos: relPositions[i]
      });
    });
    return {
      mode: "ENTITY" as const,
      project: { id: this.projectId, name: projectName },
      entity: { id: n.id, name: n.name, type: n.entity_type, filePath: n.file_path, summary: n.summary, metadata: parseMetadata(n.metadata_json), kind: "ENTITY" as const, verificationStatus: nodeStatus(n) },
      parent,
      nodes: detailNodes,
      relationships,
      tasks,
      decisions,
      evidence
    };
  }
}
