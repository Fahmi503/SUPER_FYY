import { ProjectMemory, GraphNode } from "../memory/project_memory.js";

export interface ReconciliationReport {
  reconciledCount: number;
  preservedManualCount: number;
  unverifiedCount: number;
  details: { seedId: string; name: string; action: string; matchedEntityId?: string }[];
}

export class SeedReconciler {
  private memory: ProjectMemory;

  constructor(memory: ProjectMemory) {
    this.memory = memory;
  }

  /**
   * Reconciles existing legacy seed nodes with newly indexed real repository entities.
   */
  public reconcileLegacySeed(indexedNodes: GraphNode[]): ReconciliationReport {
    const report: ReconciliationReport = {
      reconciledCount: 0,
      preservedManualCount: 0,
      unverifiedCount: 0,
      details: []
    };

    // Load existing nodes
    const existingNodes = this.memory.queryNodes({ limit: 1000 });
    const indexedByPath = new Map<string, GraphNode>();
    const indexedByName = new Map<string, GraphNode>();

    for (const node of indexedNodes) {
      if (node.file_path) {
        indexedByPath.set(node.file_path.replace(/\\/g, "/").toLowerCase(), node);
      }
      indexedByName.set(`${node.entity_type}:${node.name.toLowerCase()}`, node);
    }

    for (const seed of existingNodes) {
      let meta: Record<string, any> = {};
      try {
        meta = JSON.parse(seed.metadata_json || "{}");
      } catch {}

      // Check if seed was already part of indexed set
      if (indexedNodes.some(n => n.id === seed.id)) {
        continue;
      }

      // 1. Try matching by relative file path
      let match: GraphNode | undefined;
      if (seed.file_path) {
        const normPath = seed.file_path.replace(/\\/g, "/").toLowerCase();
        match = indexedByPath.get(normPath);
      }

      // 2. Try matching by EntityType + Name (e.g. DATABASE_TABLE:employees)
      if (!match) {
        match = indexedByName.get(`${seed.entity_type}:${seed.name.toLowerCase()}`);
      }

      if (match) {
        // Matched! Update seed node with verified metadata and retain seed ID
        meta.reconciledWith = match.id;
        meta.provenance = "VERIFIED";
        meta.reconciledAt = new Date().toISOString();

        this.memory.updateNode(seed.id, {
          summary: match.summary || seed.summary || undefined,
          filePath: match.file_path || seed.file_path || undefined,
          metadata: meta
        });

        report.reconciledCount++;
        report.details.push({
          seedId: seed.id,
          name: seed.name,
          action: "RECONCILED_WITH_REAL_ENTITY",
          matchedEntityId: match.id
        });
      } else if (meta.provenance === "MANUAL" || meta.isManual) {
        report.preservedManualCount++;
        report.details.push({
          seedId: seed.id,
          name: seed.name,
          action: "PRESERVED_AS_MANUAL_ARCHITECTURE"
        });
      } else {
        // Mark unverified
        meta.provenance = "UNVERIFIED";
        this.memory.updateNode(seed.id, { metadata: meta });
        report.unverifiedCount++;
        report.details.push({
          seedId: seed.id,
          name: seed.name,
          action: "MARKED_UNVERIFIED_EVIDENCE_PENDING"
        });
      }
    }

    return report;
  }
}
