import path from "node:path";
import { ProjectMemory, GraphNode, RelationType } from "../memory/project_memory.js";
import { ParsedRelation } from "./types.js";

export class RelationshipEngine {
  private memory: ProjectMemory;

  constructor(memory: ProjectMemory) {
    this.memory = memory;
  }

  /**
   * Resolves ParsedRelations and inferred structural relations into concrete graph_edges.
   */
  public resolveAndPersistRelationships(
    nodeMap: Map<string, GraphNode>, // key: relativePath or "TYPE:Name"
    parsedRelations: ParsedRelation[],
    folders: { id: string; relPath: string; parentRelPath?: string }[]
  ): number {
    let edgeCount = 0;

    // 1. Folder -> Subfolder CONTAINS
    for (const folder of folders) {
      if (folder.parentRelPath && folder.parentRelPath !== ".") {
        const parentNode = nodeMap.get(`FOLDER:${folder.parentRelPath}`);
        const childNode = nodeMap.get(`FOLDER:${folder.relPath}`);
        if (parentNode && childNode && parentNode.id !== childNode.id) {
          this.memory.addEdge({
            sourceId: parentNode.id,
            targetId: childNode.id,
            relationType: "CONTAINS",
            metadata: { provenance: "VERIFIED", evidence: `directory hierarchy` }
          });
          edgeCount++;
        }
      }
    }

    // 2. Folder -> File CONTAINS
    for (const [key, node] of nodeMap.entries()) {
      if (node.entity_type !== "FOLDER" && node.file_path) {
        const dir = path.dirname(node.file_path).replace(/\\/g, "/");
        const folderKey = `FOLDER:${dir}`;
        const folderNode = nodeMap.get(folderKey);
        if (folderNode) {
          this.memory.addEdge({
            sourceId: folderNode.id,
            targetId: node.id,
            relationType: "CONTAINS",
            metadata: { provenance: "VERIFIED", evidence: `file located in folder ${dir}` }
          });
          edgeCount++;
        }
      }
    }

    // Index lookup helpers for resolving target nodes
    const nodeByName = new Map<string, GraphNode[]>();
    const nodeByPath = new Map<string, GraphNode>();

    for (const node of nodeMap.values()) {
      const lowerName = node.name.toLowerCase();
      if (!nodeByName.has(lowerName)) {
        nodeByName.set(lowerName, []);
      }
      nodeByName.get(lowerName)!.push(node);

      if (node.file_path) {
        nodeByPath.set(node.file_path.replace(/\\/g, "/").toLowerCase(), node);
      }
    }

    // 3. Resolve ParsedRelations (DEFINES, IMPORTS, USES_TABLE, REFERENCES_TABLE, DOCUMENTS, etc.)
    for (const rel of parsedRelations) {
      // Find source node
      let sourceCandidates = nodeByName.get(rel.sourceName.toLowerCase()) || [];
      if (rel.sourceType) {
        const typeMatches = sourceCandidates.filter(c => c.entity_type === rel.sourceType);
        if (typeMatches.length > 0) sourceCandidates = typeMatches;
      }
      if (rel.sourcePath) {
        const pathMatches = sourceCandidates.filter(c => c.file_path && c.file_path.replace(/\\/g, "/").toLowerCase() === rel.sourcePath!.replace(/\\/g, "/").toLowerCase());
        if (pathMatches.length > 0) sourceCandidates = pathMatches;
      }
      let sourceNode: GraphNode | undefined = sourceCandidates[0];
      if (!sourceNode && rel.sourcePath && ["MODULE", "FILE", "TEST", "DOCUMENT"].includes(rel.sourceType)) {
        sourceNode = nodeByPath.get(rel.sourcePath.replace(/\\/g, "/").toLowerCase());
      }

      // Find target node
      let targetClean = rel.targetName.split(".").pop()?.toLowerCase() || rel.targetName.toLowerCase();
      let targetCandidates = nodeByName.get(rel.targetName.toLowerCase()) || nodeByName.get(targetClean) || [];
      if (rel.targetType) {
        const typeMatches = targetCandidates.filter(c => c.entity_type === rel.targetType);
        if (typeMatches.length > 0) targetCandidates = typeMatches;
      }
      if (rel.targetPath) {
        const pathMatches = targetCandidates.filter(c => c.file_path && c.file_path.replace(/\\/g, "/").toLowerCase() === rel.targetPath!.replace(/\\/g, "/").toLowerCase());
        if (pathMatches.length > 0) targetCandidates = pathMatches;
      }
      let targetNode: GraphNode | undefined = targetCandidates[0];
      if (!targetNode && rel.targetPath && ["MODULE", "FILE", "TEST", "DOCUMENT"].includes(rel.targetType)) {
        targetNode = nodeByPath.get(rel.targetPath.replace(/\\/g, "/").toLowerCase());
      }

      if (sourceNode && targetNode && sourceNode.id !== targetNode.id) {
        this.memory.addEdge({
          sourceId: sourceNode.id,
          targetId: targetNode.id,
          relationType: rel.relationType,
          metadata: {
            provenance: rel.provenance,
            evidence: rel.evidence || "parsed from source code"
          }
        });
        edgeCount++;
      }
    }

    // 4. Test -> Target Module TESTS Relationship Discovery
    for (const node of nodeMap.values()) {
      if (node.entity_type === "TEST" && node.file_path) {
        const testFile = path.basename(node.file_path);
        // Match test_<module>.py -> <module>.py
        if (testFile.startsWith("test_")) {
          const targetModuleName = testFile.replace(/^test_/, "");
          const candidates = nodeByName.get(targetModuleName.toLowerCase()) || [];
          const targetModule = candidates.find(c => c.entity_type === "MODULE" || c.entity_type === "FILE");
          if (targetModule && targetModule.id !== node.id) {
            this.memory.addEdge({
              sourceId: node.id,
              targetId: targetModule.id,
              relationType: "TESTS",
              metadata: {
                provenance: "VERIFIED",
                evidence: `test suite ${testFile} directly corresponds to ${targetModule.name}`
              }
            });
            edgeCount++;
          }
        }
      }
    }

    return edgeCount;
  }
}
