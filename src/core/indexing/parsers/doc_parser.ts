import path from "node:path";
import fs from "node:fs";
import { FileParseResult, ParsedSymbol, ParsedRelation } from "../types.js";

export class DocParser {
  public static parse(filePath: string, projectRoot: string): FileParseResult {
    const relPath = path.relative(projectRoot, filePath).replace(/\\/g, "/");
    const fileName = path.basename(filePath);

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch (err: any) {
      return {
        filePath: relPath,
        language: "markdown",
        symbols: [],
        relations: [],
        isSupported: true,
        error: `Read failure: ${err.message}`
      };
    }

    const symbols: ParsedSymbol[] = [];
    const relations: ParsedRelation[] = [];

    // Extract title from first # heading or use fileName
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const docTitle = titleMatch ? titleMatch[1].trim() : fileName;

    // First paragraph as summary
    const lines = content.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    const summary = lines.length > 0 ? lines[0].substring(0, 160) : `Document ${fileName}`;

    symbols.push({
      name: fileName,
      entityType: "DOCUMENT",
      filePath: relPath,
      summary: `${docTitle} — ${summary}`,
      metadata: { title: docTitle, language: "markdown" }
    });

    // Cross-references to source files: `src/[a-zA-Z0-9_/.-]+` or `tests/[a-zA-Z0-9_/.-]+`
    const fileRefRegex = /\b(src\/[a-zA-Z0-9_./-]+\.(?:py|ts|js|sql)|tests\/[a-zA-Z0-9_./-]+\.py)\b/g;
    const referencedFiles = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = fileRefRegex.exec(content)) !== null) {
      referencedFiles.add(m[1]);
    }

    for (const ref of referencedFiles) {
      relations.push({
        sourceName: fileName,
        sourceType: "DOCUMENT",
        sourcePath: relPath,
        targetName: path.basename(ref),
        targetType: "MODULE",
        targetPath: ref,
        relationType: "DOCUMENTS",
        provenance: "DOCUMENTATION_BASED",
        evidence: `Mentioned in ${relPath}`
      });
    }

    // Cross-references to task milestones (e.g. V6.5, V7.0, V6.4)
    const taskRefRegex = /\b(V\d+\.\d+(?:[-_][a-zA-Z0-9_-]+)?)\b/g;
    const taskRefs = new Set<string>();
    while ((m = taskRefRegex.exec(content)) !== null) {
      taskRefs.add(m[1]);
    }

    for (const tRef of taskRefs) {
      relations.push({
        sourceName: fileName,
        sourceType: "DOCUMENT",
        sourcePath: relPath,
        targetName: tRef,
        targetType: "TASK",
        relationType: "DOCUMENTS",
        provenance: "DOCUMENTATION_BASED",
        evidence: `Milestone reference ${tRef} in ${relPath}`
      });
    }

    return {
      filePath: relPath,
      language: "markdown",
      symbols,
      relations,
      isSupported: true
    };
  }
}
