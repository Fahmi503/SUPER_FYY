import path from "node:path";
import fs from "node:fs";

export class PathGuard {
  /**
   * Resolves canonical path and verifies it stays strictly within the base project directory.
   * Mitigates directory traversal, symlink escapes, and unauthorized directory access.
   */
  static validateSafeSubpath(projectRoot: string, targetPath: string): string {
    const resolvedRoot = path.resolve(projectRoot);
    const resolvedTarget = path.resolve(resolvedRoot, targetPath);

    // Verify target starts with root path
    if (!resolvedTarget.startsWith(resolvedRoot)) {
      throw new Error(`Security Violation: Path traversal detected outside project root: ${targetPath}`);
    }

    // Check if realpath escapes root if target exists
    if (fs.existsSync(resolvedTarget)) {
      const realRoot = fs.realpathSync(resolvedRoot);
      const realTarget = fs.realpathSync(resolvedTarget);
      if (!realTarget.startsWith(realRoot)) {
        throw new Error(`Security Violation: Symlink escape detected: ${targetPath}`);
      }
    }

    return resolvedTarget;
  }

  /**
   * Returns true if file/dir should be excluded by default during indexing.
   */
  static isExcluded(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, "/").toLowerCase();
    const blacklist = [
      ".env",
      "node_modules",
      "venv",
      ".venv",
      "__pycache__",
      ".git",
      ".secrets",
      "dist",
      "build",
      "coverage",
      ".pytest_cache"
    ];

    const parts = normalized.split("/");
    return parts.some(p => blacklist.includes(p) || p.startsWith(".env") || p.endsWith(".pem") || p.endsWith(".key"));
  }
}

export const validateSafeSubpath = (projectRoot: string, targetPath: string): string =>
  PathGuard.validateSafeSubpath(projectRoot, targetPath);

export const isExcluded = (relPath: string): boolean =>
  PathGuard.isExcluded(relPath);
