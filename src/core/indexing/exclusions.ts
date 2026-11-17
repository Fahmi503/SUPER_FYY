import path from "node:path";
import fs from "node:fs";
import { PathGuard } from "../security/path_guard.js";

export class ExclusionGuard {
  private static readonly DEFAULT_IGNORED_DIRS = new Set([
    ".git",
    "node_modules",
    "venv",
    ".venv",
    "env",
    "__pycache__",
    "dist",
    "build",
    ".next",
    ".turbo",
    "out",
    "target",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "coverage",
    ".nyc_output",
    ".idea",
    ".vscode",
    ".vs",
    ".agents"
  ]);

  private static readonly SENSITIVE_FILE_PATTERNS = [
    /^\.env(\..+)?$/i,
    /\.(pem|key|pkcs12|pfx|p12|token|cert|crt)$/i,
    /id_rsa/i,
    /credentials/i,
    /secret/i,
    /password/i,
    /cookie/i,
    /\.session$/i
  ];

  // Specific database and backup exclusions to protect production/test databases from indexing
  private static readonly DATABASE_AND_BACKUP_PATTERNS = [
    /\.db$/i,
    /\.sqlite$/i,
    /\.sqlite3$/i,
    /\.bak$/i,
    /\.backup$/i,
    /payroll\.db/i
  ];

  private static readonly BINARY_EXTENSIONS = new Set([
    ".exe", ".dll", ".so", ".dylib", ".bin", ".pyc", ".pyo", ".pyd",
    ".class", ".jar", ".war", ".ear",
    ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".svg", ".bmp", ".tiff",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".joblib", ".pkl", ".pickle", ".parquet", ".arrow", ".h5", ".onnx", ".model",
    ".wasm", ".woff", ".woff2", ".ttf", ".eot",
    ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv"
  ]);

  private gitignorePatterns: string[] = [];

  constructor(projectRoot: string) {
    this.loadGitignore(projectRoot);
  }

  private loadGitignore(projectRoot: string): void {
    const gitignorePath = path.join(projectRoot, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      try {
        const content = fs.readFileSync(gitignorePath, "utf-8");
        this.gitignorePatterns = content
          .split("\n")
          .map(line => line.trim())
          .filter(line => line && !line.startsWith("#"))
          .map(pattern => pattern.replace(/\/$/, ""));
      } catch {}
    }
  }

  /**
   * Determines whether a directory should be skipped completely during recursive walking.
   */
  public isDirectoryExcluded(dirName: string, relPath: string): boolean {
    const normalizedName = dirName.toLowerCase();
    const normalizedRel = relPath.replace(/\\/g, "/").toLowerCase();

    if (ExclusionGuard.DEFAULT_IGNORED_DIRS.has(normalizedName)) {
      return true;
    }

    if (dirName.startsWith(".") && dirName !== ".") {
      return true;
    }

    // Match gitignore patterns for directories
    for (const pattern of this.gitignorePatterns) {
      const cleanPat = pattern.replace(/^\//, "").toLowerCase();
      if (normalizedRel === cleanPat || normalizedRel.startsWith(cleanPat + "/")) {
        return true;
      }
    }

    return false;
  }

  /**
   * Determines whether a file should be excluded from indexing or parsing.
   */
  public isFileExcluded(
    fileName: string,
    relPath: string,
    fileSize: number,
    maxSize: number = 2 * 1024 * 1024
  ): { excluded: boolean; reason?: string } {
    const ext = path.extname(fileName).toLowerCase();
    const normalizedRel = relPath.replace(/\\/g, "/").toLowerCase();

    // 1. Size check
    if (fileSize > maxSize) {
      return { excluded: true, reason: `FILE_SIZE_EXCEEDS_LIMIT (${Math.round(fileSize / 1024)} KB)` };
    }

    // 2. Sensitive files
    for (const pat of ExclusionGuard.SENSITIVE_FILE_PATTERNS) {
      if (pat.test(fileName)) {
        return { excluded: true, reason: "SENSITIVE_CREDENTIAL_OR_TOKEN" };
      }
    }

    // 3. Database & backup files
    for (const pat of ExclusionGuard.DATABASE_AND_BACKUP_PATTERNS) {
      if (pat.test(fileName)) {
        return { excluded: true, reason: "DATABASE_FILE_PROTECTED" };
      }
    }

    // 4. Binary files
    if (ExclusionGuard.BINARY_EXTENSIONS.has(ext)) {
      return { excluded: true, reason: "BINARY_ARTIFACT_OR_IMAGE" };
    }

    // 5. Gitignore patterns
    for (const pattern of this.gitignorePatterns) {
      const cleanPat = pattern.replace(/^\//, "").toLowerCase();
      if (normalizedRel === cleanPat || normalizedRel.endsWith("/" + cleanPat) || fileName.toLowerCase() === cleanPat) {
        return { excluded: true, reason: "MATCHED_GITIGNORE" };
      }
    }

    return { excluded: false };
  }

  /**
   * Validates path traversal and symlink safety.
   */
  public static validatePath(projectRoot: string, subPath: string): string {
    return PathGuard.validateSafeSubpath(projectRoot, subPath);
  }
}
