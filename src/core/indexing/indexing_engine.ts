import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { ProjectMemory, GraphNode, EntityType } from "../memory/project_memory.js";
import { ExclusionGuard } from "./exclusions.js";
import { ParserRegistry } from "./parsers/parser_registry.js";
import { RelationshipEngine } from "./relationship_engine.js";
import { SeedReconciler } from "./seed_reconciler.js";
import { RootReconciler } from "./root_reconciler.js";
import {
  ProjectIndexingConfig,
  IndexingSummary,
  IndexingProgress,
  ParsedRelation,
  ParsedSymbol
} from "./types.js";

export class ProjectIndexingEngine {
  private memory: ProjectMemory;
  private config: ProjectIndexingConfig;
  private exclusionGuard: ExclusionGuard;

  constructor(memory: ProjectMemory, config: ProjectIndexingConfig) {
    this.memory = memory;
    this.config = config;
    this.exclusionGuard = new ExclusionGuard(config.projectRoot);
  }

  /**
   * Performs complete or incremental deep indexing across the project.
   */
  public async indexProject(
    onProgress?: (progress: IndexingProgress) => void
  ): Promise<IndexingSummary> {
    const startTime = Date.now();
    const projectRoot = path.resolve(this.config.projectRoot);

    if (!fs.existsSync(projectRoot)) {
      throw new Error(`Target project directory not found: ${projectRoot}`);
    }

    const summary: IndexingSummary = {
      projectId: this.config.projectId,
      projectRoot,
      totalFolders: 0,
      totalFiles: 0,
      parsedFiles: 0,
      excludedFiles: 0,
      failedFiles: 0,
      totalSymbols: 0,
      totalEntities: 0,
      totalRelationships: 0,
      unknownEntityTypes: 0,
      unverifiedRecords: 0,
      durationMs: 0,
      errors: [],
      entityCounts: {},
      relationCounts: {}
    };

    onProgress?.({
      phase: "SCANNING",
      totalFiles: 0,
      processedFiles: 0
    });

    // 1. Recursive Walk (Folders & Files)
    const discoveredFolders: { relPath: string; parentRelPath?: string; name: string }[] = [];
    const discoveredFiles: {
      absPath: string;
      relPath: string;
      fileName: string;
      size: number;
      mtime: string;
    }[] = [];

    const walkDir = (currentDir: string, parentRel?: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      const currentRel = path.relative(projectRoot, currentDir).replace(/\\/g, "/") || ".";

      if (currentRel !== ".") {
        discoveredFolders.push({
          relPath: currentRel,
          parentRelPath: parentRel || ".",
          name: path.basename(currentDir)
        });
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.relative(projectRoot, fullPath).replace(/\\/g, "/");

        if (entry.isDirectory()) {
          if (!this.exclusionGuard.isDirectoryExcluded(entry.name, relPath)) {
            walkDir(fullPath, currentRel);
          }
        } else if (entry.isFile()) {
          try {
            const stat = fs.statSync(fullPath);
            const check = this.exclusionGuard.isFileExcluded(
              entry.name,
              relPath,
              stat.size,
              this.config.maxFileSizeBytes
            );

            if (check.excluded) {
              summary.excludedFiles++;
            } else {
              discoveredFiles.push({
                absPath: fullPath,
                relPath,
                fileName: entry.name,
                size: stat.size,
                mtime: stat.mtime.toISOString()
              });
            }
          } catch (err: any) {
            summary.failedFiles++;
            summary.errors.push({ path: relPath, error: err.message });
          }
        }
      }
    };

    walkDir(projectRoot);

    summary.totalFolders = discoveredFolders.length;
    summary.totalFiles = discoveredFiles.length;

    onProgress?.({
      phase: "PARSING",
      totalFiles: discoveredFiles.length,
      processedFiles: 0
    });

    // 2. Incremental Parsing and Ingestion within SQLite Transaction
    const allParsedRelations: ParsedRelation[] = [];
    const createdNodes: GraphNode[] = [];
    const nodeLookupMap = new Map<string, GraphNode>();

    this.memory.withTransaction(() => {
      // 2A. Persist Folder Entities
      for (const f of discoveredFolders) {
        let folderNode = this.memory.findNodeByPath(f.relPath);
        if (!folderNode) {
          folderNode = this.memory.addNode({
            entityType: "FOLDER",
            name: f.name,
            filePath: f.relPath,
            summary: `Folder ${f.relPath}`,
            metadata: {
              canonicalPath: f.relPath,
              parentFolder: f.parentRelPath,
              provenance: "VERIFIED"
            }
          });
        }
        nodeLookupMap.set(`FOLDER:${f.relPath}`, folderNode);
        createdNodes.push(folderNode);
      }

      // 2B. Process Files (Incremental check)
      let processed = 0;
      for (const file of discoveredFiles) {
        processed++;
        onProgress?.({
          phase: "PARSING",
          totalFiles: discoveredFiles.length,
          processedFiles: processed,
          currentFile: file.relPath
        });

        // Compute content hash
        let contentHash = "";
        try {
          const fileBuf = fs.readFileSync(file.absPath);
          contentHash = crypto.createHash("sha256").update(fileBuf).digest("hex");
        } catch (err: any) {
          summary.failedFiles++;
          summary.errors.push({ path: file.relPath, error: `Hash computation error: ${err.message}` });
          continue;
        }

        const existingIndexed = this.memory.getIndexedFile(file.relPath);
        const isUnchanged = existingIndexed && existingIndexed.content_hash === contentHash && existingIndexed.file_size === file.size;

        if (isUnchanged) {
          // File unchanged: retrieve existing node
          const existingNode = this.memory.findNodeByPath(file.relPath);
          if (existingNode) {
            nodeLookupMap.set(file.relPath, existingNode);
            nodeLookupMap.set(`${existingNode.entity_type}:${existingNode.name}`, existingNode);
            createdNodes.push(existingNode);
          }
          summary.parsedFiles++;
          continue;
        }

        // Modified or new file: clear previous symbols for this file path
        if (existingIndexed) {
          this.memory.removeNodesByFilePath(file.relPath);
        }

        // Parse file AST / metadata
        const parseResult = ParserRegistry.parseFile(file.absPath, projectRoot, {
          allowPythonProcess: this.config.allowExternalPythonAst !== false
        });

        if (parseResult.error) {
          summary.errors.push({ path: file.relPath, error: parseResult.error });
        }

        // Persist parsed symbols as graph nodes
        for (const sym of parseResult.symbols) {
          const meta = {
            ...(sym.metadata || {}),
            contentHash,
            lineStart: sym.lineStart,
            lineEnd: sym.lineEnd,
            parentName: sym.parentName,
            provenance: "VERIFIED"
          };

          const node = this.memory.addNode({
            entityType: sym.entityType,
            name: sym.name,
            filePath: sym.filePath,
            summary: sym.summary,
            metadata: meta
          });

          createdNodes.push(node);
          summary.totalSymbols++;

          if (sym.entityType === "UNKNOWN") {
            summary.unknownEntityTypes++;
          }

          // Register in lookup map
          nodeLookupMap.set(sym.filePath, node);
          nodeLookupMap.set(`${sym.entityType}:${sym.name}`, node);
        }

        allParsedRelations.push(...parseResult.relations);

        // Update indexed_files tracking record
        this.memory.saveIndexedFile({
          relative_path: file.relPath,
          content_hash: contentHash,
          file_size: file.size,
          last_modified: file.mtime,
          last_indexed_at: new Date().toISOString(),
          status: "ACTIVE"
        });

        summary.parsedFiles++;
      }
    });

    onProgress?.({
      phase: "RELATING",
      totalFiles: discoveredFiles.length,
      processedFiles: discoveredFiles.length
    });

    // 3. Resolve and Persist Relationships within Transaction
    const relEngine = new RelationshipEngine(this.memory);
    let persistedEdgeCount = 0;
    this.memory.withTransaction(() => {
      persistedEdgeCount = relEngine.resolveAndPersistRelationships(
        nodeLookupMap,
        allParsedRelations,
        discoveredFolders.map(f => ({
          id: nodeLookupMap.get(`FOLDER:${f.relPath}`)?.id || "",
          relPath: f.relPath,
          parentRelPath: f.parentRelPath
        }))
      );
    });
    summary.totalRelationships = persistedEdgeCount;

    onProgress?.({
      phase: "RECONCILING",
      totalFiles: discoveredFiles.length,
      processedFiles: discoveredFiles.length
    });

    // 4. Reconcile Legacy Seed Nodes
    const reconciler = new SeedReconciler(this.memory);
    reconciler.reconcileLegacySeed(createdNodes);

    // 4B. Reconcile Project Root & Hierarchical Semantic Relationships (M11.3)
    RootReconciler.reconcileProjectRoot(this.memory, this.config.projectName);

    // 5. Gather Final Graph Counts
    const allGraph = this.memory.getGraph({ limit: 10000 });
    summary.totalEntities = allGraph.nodes.length;

    for (const n of allGraph.nodes) {
      summary.entityCounts[n.entity_type] = (summary.entityCounts[n.entity_type] || 0) + 1;
    }
    for (const e of allGraph.edges) {
      summary.relationCounts[e.relation_type] = (summary.relationCounts[e.relation_type] || 0) + 1;
    }

    summary.durationMs = Date.now() - startTime;

    onProgress?.({
      phase: "COMPLETED",
      totalFiles: discoveredFiles.length,
      processedFiles: discoveredFiles.length
    });

    return summary;
  }
}
