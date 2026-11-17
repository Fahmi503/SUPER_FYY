import path from "node:path";
import fs from "node:fs";
import ts from "typescript";
import { FileParseResult, ParsedSymbol, ParsedRelation } from "../types.js";

export class TsJsParser {
  public static parse(filePath: string, projectRoot: string): FileParseResult {
    const relPath = path.relative(projectRoot, filePath).replace(/\\/g, "/");
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const isTestFile = relPath.includes("__tests__") || relPath.endsWith(".test.ts") || relPath.endsWith(".test.js") || relPath.endsWith(".spec.ts");

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch (err: any) {
      return {
        filePath: relPath,
        language: ext.includes("ts") ? "typescript" : "javascript",
        symbols: [],
        relations: [],
        isSupported: true,
        error: `Read failure: ${err.message}`
      };
    }

    const scriptKind = ext === ".tsx" ? ts.ScriptKind.TSX : ext === ".jsx" ? ts.ScriptKind.JSX : ext.includes("ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, scriptKind);

    const symbols: ParsedSymbol[] = [];
    const relations: ParsedRelation[] = [];

    // Module / Test entity
    symbols.push({
      name: fileName,
      entityType: isTestFile ? "TEST" : "MODULE",
      filePath: relPath,
      summary: `${ext.includes("ts") ? "TypeScript" : "JavaScript"} ${isTestFile ? "test suite" : "module"} ${fileName}`,
      metadata: { isTest: isTestFile, language: ext.includes("ts") ? "typescript" : "javascript" }
    });

    const visit = (node: ts.Node, parentClass?: string) => {
      // 1. Class
      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.text;
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        symbols.push({
          name: className,
          entityType: "CLASS",
          filePath: relPath,
          lineStart: line,
          summary: `Class ${className}`
        });

        relations.push({
          sourceName: fileName,
          sourceType: isTestFile ? "TEST" : "MODULE",
          sourcePath: relPath,
          targetName: className,
          targetType: "CLASS",
          targetPath: relPath,
          relationType: "DEFINES",
          provenance: "VERIFIED",
          evidence: `class ${className} at line ${line}`
        });

        // Heritage (extends, implements)
        if (node.heritageClauses) {
          for (const hc of node.heritageClauses) {
            for (const type of hc.types) {
              const baseName = type.expression.getText(sourceFile);
              relations.push({
                sourceName: className,
                sourceType: "CLASS",
                sourcePath: relPath,
                targetName: baseName,
                targetType: "CLASS",
                relationType: hc.token === ts.SyntaxKind.ExtendsKeyword ? "DEPENDS_ON" : "IMPLEMENTS",
                provenance: "VERIFIED",
                evidence: `${hc.token === ts.SyntaxKind.ExtendsKeyword ? "extends" : "implements"} ${baseName}`
              });
            }
          }
        }

        // Visit members of class with parentClass context
        ts.forEachChild(node, child => visit(child, className));
        return;
      }

      // 2. Method
      if (ts.isMethodDeclaration(node) && node.name && parentClass) {
        const methodName = node.name.getText(sourceFile);
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const fullName = `${parentClass}.${methodName}`;
        symbols.push({
          name: fullName,
          entityType: "FUNCTION",
          filePath: relPath,
          lineStart: line,
          parentName: parentClass,
          summary: `Method ${methodName} of ${parentClass}`
        });

        relations.push({
          sourceName: parentClass,
          sourceType: "CLASS",
          sourcePath: relPath,
          targetName: fullName,
          targetType: "FUNCTION",
          targetPath: relPath,
          relationType: "DEFINES",
          provenance: "VERIFIED",
          evidence: `method ${methodName} at line ${line}`
        });
        return;
      }

      // 3. Standalone Function
      if (ts.isFunctionDeclaration(node) && node.name) {
        const funcName = node.name.text;
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        symbols.push({
          name: funcName,
          entityType: "FUNCTION",
          filePath: relPath,
          lineStart: line,
          summary: `Function ${funcName}`
        });

        relations.push({
          sourceName: fileName,
          sourceType: isTestFile ? "TEST" : "MODULE",
          sourcePath: relPath,
          targetName: funcName,
          targetType: "FUNCTION",
          targetPath: relPath,
          relationType: "DEFINES",
          provenance: "VERIFIED",
          evidence: `function ${funcName} at line ${line}`
        });
        return;
      }

      // 4. Imports
      if (ts.isImportDeclaration(node)) {
        const moduleSpec = node.moduleSpecifier.getText(sourceFile).replace(/['"]/g, "");
        relations.push({
          sourceName: fileName,
          sourceType: isTestFile ? "TEST" : "MODULE",
          sourcePath: relPath,
          targetName: moduleSpec,
          targetType: "MODULE",
          relationType: "IMPORTS",
          provenance: "VERIFIED",
          evidence: `import from ${moduleSpec}`
        });
        return;
      }

      // 5. API Endpoints (e.g. app.get("/api/...", ...), router.post(...))
      if (ts.isCallExpression(node)) {
        const text = node.expression.getText(sourceFile);
        if (/\b(app|router|server)\.(get|post|put|delete|patch)\b/.test(text)) {
          const args = node.arguments;
          if (args.length > 0 && ts.isStringLiteral(args[0])) {
            const routePath = args[0].text;
            const epName = `ROUTE:${routePath}`;
            symbols.push({
              name: epName,
              entityType: "API_ENDPOINT",
              filePath: relPath,
              summary: `API Route: ${text}('${routePath}')`
            });

            relations.push({
              sourceName: fileName,
              sourceType: "MODULE",
              sourcePath: relPath,
              targetName: epName,
              targetType: "API_ENDPOINT",
              targetPath: relPath,
              relationType: "DEFINES",
              provenance: "VERIFIED",
              evidence: `HTTP route ${routePath}`
            });
          }
        }
      }

      ts.forEachChild(node, child => visit(child, parentClass));
    };

    visit(sourceFile);

    return {
      filePath: relPath,
      language: ext.includes("ts") ? "typescript" : "javascript",
      symbols,
      relations,
      isSupported: true
    };
  }
}
