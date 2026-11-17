import { EntityType, RelationType } from "../memory/project_memory.js";

export type ProvenanceType = "VERIFIED" | "INFERRED" | "DOCUMENTATION_BASED" | "MANUAL";

export interface ProjectIndexingConfig {
  projectId: string;
  projectName?: string;
  projectRoot: string;
  excludePatterns?: string[];
  maxFileSizeBytes?: number; // default 2MB (2 * 1024 * 1024)
  allowExternalPythonAst?: boolean; // default true
}

export interface ParsedSymbol {
  name: string;
  entityType: EntityType;
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  summary?: string;
  parentName?: string;
  metadata?: Record<string, unknown>;
}

export interface ParsedRelation {
  sourceName: string;
  sourceType: EntityType;
  sourcePath?: string;
  targetName: string;
  targetType: EntityType;
  targetPath?: string;
  relationType: RelationType;
  provenance: ProvenanceType;
  evidence?: string;
  metadata?: Record<string, unknown>;
}

export interface FileParseResult {
  filePath: string;
  language: string;
  symbols: ParsedSymbol[];
  relations: ParsedRelation[];
  isSupported: boolean;
  error?: string;
}

export interface IndexingProgress {
  phase: "SCANNING" | "PARSING" | "RELATING" | "RECONCILING" | "SAVING" | "COMPLETED" | "FAILED";
  totalFiles: number;
  processedFiles: number;
  currentFile?: string;
}

export interface IndexingSummary {
  projectId: string;
  projectRoot: string;
  totalFolders: number;
  totalFiles: number;
  parsedFiles: number;
  excludedFiles: number;
  failedFiles: number;
  totalSymbols: number;
  totalEntities: number;
  totalRelationships: number;
  unknownEntityTypes: number;
  unverifiedRecords: number;
  durationMs: number;
  errors: { path: string; error: string }[];
  entityCounts: Record<string, number>;
  relationCounts: Record<string, number>;
}
