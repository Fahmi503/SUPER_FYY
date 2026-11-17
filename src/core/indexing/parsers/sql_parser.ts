import path from "node:path";
import fs from "node:fs";
import { FileParseResult, ParsedSymbol, ParsedRelation } from "../types.js";

export class SqlParser {
  public static parse(filePath: string, projectRoot: string): FileParseResult {
    const relPath = path.relative(projectRoot, filePath).replace(/\\/g, "/");
    const fileName = path.basename(filePath);

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch (err: any) {
      return {
        filePath: relPath,
        language: "sql",
        symbols: [],
        relations: [],
        isSupported: true,
        error: `Read failure: ${err.message}`
      };
    }

    const symbols: ParsedSymbol[] = [];
    const relations: ParsedRelation[] = [];

    // File entity
    symbols.push({
      name: fileName,
      entityType: "FILE",
      filePath: relPath,
      summary: `SQL schema file ${fileName}`,
      metadata: { language: "sql" }
    });

    // Match CREATE TABLE [IF NOT EXISTS] table_name (body)
    const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*?)\);/gi;
    let match: RegExpExecArray | null;

    while ((match = createTableRegex.exec(content)) !== null) {
      const tableName = match[1];
      const tableBody = match[2];

      symbols.push({
        name: tableName,
        entityType: "DATABASE_TABLE",
        filePath: relPath,
        summary: `Database table ${tableName} defined in ${relPath}`,
        metadata: {
          tableSource: relPath,
          provenance: "SOURCE_CODE_VERIFIED"
        }
      });

      // Relation: File DEFINES Table
      relations.push({
        sourceName: fileName,
        sourceType: "FILE",
        sourcePath: relPath,
        targetName: tableName,
        targetType: "DATABASE_TABLE",
        targetPath: relPath,
        relationType: "DEFINES",
        provenance: "VERIFIED",
        evidence: `CREATE TABLE ${tableName}`
      });

      // Extract Foreign Keys: FOREIGN KEY (...) REFERENCES target_table(...)
      const fkRegex = /FOREIGN\s+KEY\s*\([^)]+\)\s*REFERENCES\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
      let fkMatch: RegExpExecArray | null;
      while ((fkMatch = fkRegex.exec(tableBody)) !== null) {
        const targetTable = fkMatch[1];
        relations.push({
          sourceName: tableName,
          sourceType: "DATABASE_TABLE",
          sourcePath: relPath,
          targetName: targetTable,
          targetType: "DATABASE_TABLE",
          relationType: "REFERENCES_TABLE",
          provenance: "VERIFIED",
          evidence: `FOREIGN KEY REFERENCES ${targetTable}`
        });
      }
    }

    return {
      filePath: relPath,
      language: "sql",
      symbols,
      relations,
      isSupported: true
    };
  }
}
