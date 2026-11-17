import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FileParseResult, ParsedSymbol, ParsedRelation } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PythonParser {
  private static getExtractorScriptPath(): string {
    const candidate1 = path.join(__dirname, "python_ast_extractor.py");
    if (fs.existsSync(candidate1)) return candidate1;
    const candidate2 = path.resolve(__dirname, "../../../../src/core/indexing/parsers/python_ast_extractor.py");
    if (fs.existsSync(candidate2)) return candidate2;
    const candidate3 = path.resolve(process.cwd(), "src/core/indexing/parsers/python_ast_extractor.py");
    if (fs.existsSync(candidate3)) return candidate3;
    return candidate1;
  }

  /**
   * Parses Python source file into symbols and relationships.
   */
  public static parse(filePath: string, projectRoot: string, allowPythonProcess: boolean = true): FileParseResult {
    const relPath = path.relative(projectRoot, filePath).replace(/\\/g, "/");
    const moduleName = path.basename(filePath, ".py");
    const isTestFile = relPath.startsWith("tests/") || path.basename(filePath).startsWith("test_");

    let astData: any = null;
    const scriptPath = this.getExtractorScriptPath();

    if (allowPythonProcess && fs.existsSync(scriptPath)) {
      try {
        const out = execFileSync("python", [scriptPath, filePath], {
          encoding: "utf-8",
          timeout: 10000,
          maxBuffer: 5 * 1024 * 1024
        });
        astData = JSON.parse(out);
      } catch (err: any) {
        // Fall back to TypeScript native parser
      }
    }

    if (!astData || astData.error) {
      astData = this.fallbackTsParser(filePath);
    }

    const symbols: ParsedSymbol[] = [];
    const relations: ParsedRelation[] = [];

    // 1. File / Module entity symbol
    symbols.push({
      name: path.basename(filePath),
      entityType: isTestFile ? "TEST" : "MODULE",
      filePath: relPath,
      summary: astData.docstring || (isTestFile ? `Test suite ${moduleName}` : `Python module ${moduleName}`),
      metadata: {
        isTest: isTestFile,
        language: "python"
      }
    });

    // 2. Classes
    for (const c of astData.classes || []) {
      symbols.push({
        name: c.name,
        entityType: "CLASS",
        filePath: relPath,
        lineStart: c.lineStart,
        lineEnd: c.lineEnd,
        summary: c.summary,
        metadata: { bases: c.bases }
      });

      // Relation: File DEFINES Class
      relations.push({
        sourceName: path.basename(filePath),
        sourceType: isTestFile ? "TEST" : "MODULE",
        sourcePath: relPath,
        targetName: c.name,
        targetType: "CLASS",
        targetPath: relPath,
        relationType: "DEFINES",
        provenance: "VERIFIED",
        evidence: `class ${c.name} at line ${c.lineStart}`
      });

      // Class bases dependency
      for (const base of c.bases || []) {
        relations.push({
          sourceName: c.name,
          sourceType: "CLASS",
          sourcePath: relPath,
          targetName: base,
          targetType: "CLASS",
          relationType: "DEPENDS_ON",
          provenance: "VERIFIED",
          evidence: `inherits from ${base}`
        });
      }
    }

    // 3. Functions / Methods
    for (const f of astData.functions || []) {
      const isMethod = !!f.parent;
      symbols.push({
        name: f.name,
        entityType: "FUNCTION",
        filePath: relPath,
        lineStart: f.lineStart,
        lineEnd: f.lineEnd,
        summary: f.summary,
        parentName: f.parent,
        metadata: { decorators: f.decorators, isMethod }
      });

      // Relation: Class or File DEFINES Function
      if (f.parent) {
        relations.push({
          sourceName: f.parent,
          sourceType: "CLASS",
          sourcePath: relPath,
          targetName: f.name,
          targetType: "FUNCTION",
          targetPath: relPath,
          relationType: "DEFINES",
          provenance: "VERIFIED",
          evidence: `method ${f.name} at line ${f.lineStart}`
        });
      } else {
        relations.push({
          sourceName: path.basename(filePath),
          sourceType: isTestFile ? "TEST" : "MODULE",
          sourcePath: relPath,
          targetName: f.name,
          targetType: "FUNCTION",
          targetPath: relPath,
          relationType: "DEFINES",
          provenance: "VERIFIED",
          evidence: `function ${f.name} at line ${f.lineStart}`
        });
      }
    }

    // 4. API Endpoints
    for (const ep of astData.endpoints || []) {
      symbols.push({
        name: ep.name,
        entityType: "API_ENDPOINT",
        filePath: relPath,
        lineStart: ep.line,
        summary: `API Route: ${ep.decorator}`,
        metadata: { decorator: ep.decorator }
      });

      relations.push({
        sourceName: path.basename(filePath),
        sourceType: "MODULE",
        sourcePath: relPath,
        targetName: ep.name,
        targetType: "API_ENDPOINT",
        targetPath: relPath,
        relationType: "DEFINES",
        provenance: "VERIFIED",
        evidence: `route decorator ${ep.decorator}`
      });
    }

    // 5. Imports -> File IMPORTS Module
    for (const imp of astData.imports || []) {
      const targetMod = imp.module ? `${imp.module}.${imp.name}` : imp.name;
      relations.push({
        sourceName: path.basename(filePath),
        sourceType: isTestFile ? "TEST" : "MODULE",
        sourcePath: relPath,
        targetName: targetMod,
        targetType: "MODULE",
        relationType: "IMPORTS",
        provenance: "VERIFIED",
        evidence: `import ${targetMod}`
      });
    }

    // 6. SQL Database Tables -> File USES_TABLE Database Table
    for (const tbl of astData.sqlTables || []) {
      relations.push({
        sourceName: path.basename(filePath),
        sourceType: isTestFile ? "TEST" : "MODULE",
        sourcePath: relPath,
        targetName: tbl,
        targetType: "DATABASE_TABLE",
        relationType: "USES_TABLE",
        provenance: "VERIFIED",
        evidence: `SQL reference in ${relPath}`
      });
    }

    return {
      filePath: relPath,
      language: "python",
      symbols,
      relations,
      isSupported: true
    };
  }

  /**
   * Fallback regex-based parser in pure TypeScript if python CLI cannot run.
   */
  private static fallbackTsParser(filePath: string): any {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    const classes: any[] = [];
    const functions: any[] = [];
    const imports: any[] = [];

    const classRegex = /^class\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\(([^)]*)\))?:/;
    const funcRegex = /^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;
    const importRegex = /^import\s+([a-zA-Z0-9_.,\s]+)/;
    const fromImportRegex = /^from\s+([a-zA-Z0-9_.]+)\s+import\s+([a-zA-Z0-9_.,\s*]+)/;

    let currentClass: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Class
      const cMatch = line.match(classRegex);
      if (cMatch) {
        currentClass = cMatch[1];
        const bases = cMatch[2] ? cMatch[2].split(",").map(b => b.trim()).filter(Boolean) : [];
        classes.push({
          name: currentClass,
          lineStart: lineNum,
          lineEnd: lineNum,
          summary: `Class ${currentClass}`,
          bases
        });
        continue;
      }

      // Check indentation reset for currentClass
      if (currentClass && line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t")) {
        currentClass = null;
      }

      // Function
      const fMatch = line.match(funcRegex);
      if (fMatch) {
        const funcName = fMatch[1];
        functions.push({
          name: currentClass ? `${currentClass}.${funcName}` : funcName,
          parent: currentClass,
          lineStart: lineNum,
          lineEnd: lineNum,
          summary: currentClass ? `Method ${funcName}` : `Function ${funcName}`,
          decorators: []
        });
        continue;
      }

      // Imports
      const impMatch = line.match(importRegex);
      if (impMatch) {
        const mods = impMatch[1].split(",").map(m => m.trim());
        for (const m of mods) {
          imports.push({ module: m, name: m });
        }
        continue;
      }

      const fromMatch = line.match(fromImportRegex);
      if (fromMatch) {
        const mod = fromMatch[1];
        const names = fromMatch[2].split(",").map(n => n.trim());
        for (const n of names) {
          imports.push({ module: mod, name: n });
        }
      }
    }

    return {
      docstring: "",
      classes,
      functions,
      imports,
      endpoints: [],
      sqlTables: []
    };
  }
}
