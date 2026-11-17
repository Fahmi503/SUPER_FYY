import path from "node:path";
import fs from "node:fs";
import { FileParseResult } from "../types.js";
import { PythonParser } from "./python_parser.js";
import { TsJsParser } from "./ts_js_parser.js";
import { SqlParser } from "./sql_parser.js";
import { DocParser } from "./doc_parser.js";

export class ParserRegistry {
  public static parseFile(
    filePath: string,
    projectRoot: string,
    options: { allowPythonProcess?: boolean } = {}
  ): FileParseResult {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    const relPath = path.relative(projectRoot, filePath).replace(/\\/g, "/");

    // 1. Python
    if (ext === ".py") {
      return PythonParser.parse(filePath, projectRoot, options.allowPythonProcess !== false);
    }

    // 2. TypeScript / JavaScript
    if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
      return TsJsParser.parse(filePath, projectRoot);
    }

    // 3. SQL
    if (ext === ".sql") {
      return SqlParser.parse(filePath, projectRoot);
    }

    // 4. Markdown Documentation
    if ([".md", ".markdown"].includes(ext)) {
      return DocParser.parse(filePath, projectRoot);
    }

    // 5. Supported Metadata-Only File Formats (JSON, YAML, TOML, INI, CSS, HTML)
    const metadataExtensions: Record<string, string> = {
      ".json": "json",
      ".yaml": "yaml",
      ".yml": "yaml",
      ".toml": "toml",
      ".ini": "ini",
      ".css": "css",
      ".html": "html",
      ".txt": "text"
    };

    if (metadataExtensions[ext]) {
      let lineCount = 0;
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        lineCount = content.split("\n").length;
      } catch {}

      return {
        filePath: relPath,
        language: metadataExtensions[ext],
        symbols: [
          {
            name: fileName,
            entityType: "FILE",
            filePath: relPath,
            summary: `${metadataExtensions[ext].toUpperCase()} configuration/data file (${lineCount} lines)`,
            metadata: {
              language: metadataExtensions[ext],
              lineCount,
              semanticParsing: "NOT_SUPPORTED"
            }
          }
        ],
        relations: [],
        isSupported: false
      };
    }

    // 6. Unknown / Unsupported
    return {
      filePath: relPath,
      language: "unknown",
      symbols: [
        {
          name: fileName,
          entityType: "UNKNOWN",
          filePath: relPath,
          summary: `Unrecognized file format (${ext || "no ext"})`,
          metadata: {
            semanticParsing: "NOT_SUPPORTED",
            rawExtension: ext
          }
        }
      ],
      relations: [],
      isSupported: false
    };
  }
}
