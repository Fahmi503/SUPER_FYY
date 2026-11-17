import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

import { ProjectRegistry } from "../core/registry/project_registry.js";
import { ProjectMemory } from "../core/memory/project_memory.js";
import { ProjectIndexingEngine } from "../core/indexing/indexing_engine.js";
import { ExclusionGuard } from "../core/indexing/exclusions.js";
import { PythonParser } from "../core/indexing/parsers/python_parser.js";
import { TsJsParser } from "../core/indexing/parsers/ts_js_parser.js";
import { SqlParser } from "../core/indexing/parsers/sql_parser.js";
import { DocParser } from "../core/indexing/parsers/doc_parser.js";
import { ParserRegistry } from "../core/indexing/parsers/parser_registry.js";
import { GraphEngine } from "../core/graph/graph_engine.js";
import { SeedReconciler } from "../core/indexing/seed_reconciler.js";

test("SUPER FYY Phase M11 — Deep Indexing & Relationship Discovery Engine Suite", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "superfyy_m11_test_"));
  const projectFolder = path.join(tmpRoot, "MOCK_REPO");
  fs.mkdirSync(projectFolder, { recursive: true });

  // 1. Setup mock repository files
  // Folders
  fs.mkdirSync(path.join(projectFolder, "src", "auth"), { recursive: true });
  fs.mkdirSync(path.join(projectFolder, "src", "payroll"), { recursive: true });
  fs.mkdirSync(path.join(projectFolder, "src", "db"), { recursive: true });
  fs.mkdirSync(path.join(projectFolder, "tests"), { recursive: true });
  fs.mkdirSync(path.join(projectFolder, "docs"), { recursive: true });
  fs.mkdirSync(path.join(projectFolder, "empty_dir"), { recursive: true });

  // Excluded directories
  fs.mkdirSync(path.join(projectFolder, ".git"), { recursive: true });
  fs.mkdirSync(path.join(projectFolder, "node_modules", "dummy"), { recursive: true });
  fs.mkdirSync(path.join(projectFolder, "__pycache__"), { recursive: true });

  // Python Auth file
  fs.writeFileSync(
    path.join(projectFolder, "src", "auth", "session.py"),
    `"""Session token manager and RBAC authorization."""
from datetime import datetime
import sqlite3

class SessionManager:
    """Handles token validation."""
    def validate_token(self, token: str) -> bool:
        return True

def create_session(user_id: int):
    """Factory for user sessions."""
    return {"user_id": user_id}
`
  );

  // Python Payroll file referencing tables & importing session
  fs.writeFileSync(
    path.join(projectFolder, "src", "payroll", "calculator.py"),
    `"""Payroll Calculation Engine."""
from src.auth.session import SessionManager
import sqlite3

class PayrollCalculator:
    def calculate_salary(self, emp_id: int):
        # Queries employees table
        query = "SELECT * FROM employees WHERE id = ?"
        insert = "INSERT INTO payroll_records (emp_id, gross) VALUES (?, ?)"
        return 5000.0
`
  );

  // Python Test file
  fs.writeFileSync(
    path.join(projectFolder, "tests", "test_calculator.py"),
    `import pytest
from src.payroll.calculator import PayrollCalculator

def test_salary_calculation():
    calc = PayrollCalculator()
    assert calc.calculate_salary(1) == 5000.0
`
  );

  // TypeScript service
  fs.writeFileSync(
    path.join(projectFolder, "src", "auth", "auth_service.ts"),
    `import { BaseService } from "./base_service";

export class AuthService extends BaseService {
  public login(user: string): string {
    return "token_123";
  }
}
`
  );

  // SQL Schema
  fs.writeFileSync(
    path.join(projectFolder, "src", "db", "schema.sql"),
    `CREATE TABLE IF NOT EXISTS departments (
      dept_id INTEGER PRIMARY KEY,
      dept_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      department_id INTEGER,
      FOREIGN KEY (department_id) REFERENCES departments(dept_id)
    );
`
  );

  // Documentation file
  fs.writeFileSync(
    path.join(projectFolder, "docs", "ARCHITECTURE.md"),
    `# System Architecture Spec

The core calculator is located in src/payroll/calculator.py and tested by tests/test_calculator.py.
Milestone V6.5 implements enterprise RBAC.
`
  );

  // Sensitive & Excluded files
  fs.writeFileSync(path.join(projectFolder, ".env"), "SECRET_KEY=supersecret\n");
  fs.writeFileSync(path.join(projectFolder, "private.key"), "PRIVATE KEY DUMMY");
  fs.writeFileSync(path.join(projectFolder, "payroll.db"), "SQLITE DUMMY BINARY DATA");
  fs.writeFileSync(path.join(projectFolder, "node_modules", "dummy", "index.js"), "module.exports = {};");
  fs.writeFileSync(path.join(projectFolder, ".git", "config"), "[core]\n");

  // Unsupported/Metadata-only file
  fs.writeFileSync(path.join(projectFolder, "config.json"), '{"env": "production", "port": 8080}');

  // Project Registry & Memory
  const registry = new ProjectRegistry(tmpRoot);
  const proj = registry.registerProject({
    name: "Mock Enterprise Project",
    canonicalPath: projectFolder,
    technology: "Polyglot"
  });

  const memory = new ProjectMemory(proj.memory_db_path, proj.id);
  const graphEngine = new GraphEngine(memory);

  t.after(() => {
    try {
      memory.close();
      registry.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  await t.test("A. Security & Exclusion Guard Verification", () => {
    const guard = new ExclusionGuard(projectFolder);

    // Dirs
    assert.equal(guard.isDirectoryExcluded(".git", ".git"), true);
    assert.equal(guard.isDirectoryExcluded("node_modules", "node_modules"), true);
    assert.equal(guard.isDirectoryExcluded("__pycache__", "__pycache__"), true);
    assert.equal(guard.isDirectoryExcluded("auth", "src/auth"), false);

    // Sensitive files
    assert.equal(guard.isFileExcluded(".env", ".env", 50).excluded, true);
    assert.equal(guard.isFileExcluded("private.key", "private.key", 100).excluded, true);
    assert.equal(guard.isFileExcluded("payroll.db", "payroll.db", 200).excluded, true);
    assert.equal(guard.isFileExcluded("calculator.py", "src/payroll/calculator.py", 500).excluded, false);

    // Path traversal guard
    assert.throws(() => {
      ExclusionGuard.validatePath(projectFolder, "../../outside_file.txt");
    }, /traversal/i);
  });

  await t.test("B. Language Parsers Direct Verification", () => {
    // Python Parser
    const pyRes = PythonParser.parse(
      path.join(projectFolder, "src", "payroll", "calculator.py"),
      projectFolder,
      true
    );
    assert.equal(pyRes.isSupported, true);
    assert.ok(pyRes.symbols.some(s => s.name === "PayrollCalculator" && s.entityType === "CLASS"));
    assert.ok(pyRes.symbols.some(s => s.name.includes("calculate_salary") && s.entityType === "FUNCTION"));
    assert.ok(pyRes.relations.some(r => r.targetName === "employees" && r.relationType === "USES_TABLE"));

    // TypeScript Parser
    const tsRes = TsJsParser.parse(
      path.join(projectFolder, "src", "auth", "auth_service.ts"),
      projectFolder
    );
    assert.equal(tsRes.isSupported, true);
    assert.ok(tsRes.symbols.some(s => s.name === "AuthService" && s.entityType === "CLASS"));
    assert.ok(tsRes.symbols.some(s => s.name === "AuthService.login" && s.entityType === "FUNCTION"));
    assert.ok(tsRes.relations.some(r => r.targetName === "BaseService" && r.relationType === "DEPENDS_ON"));

    // SQL Parser
    const sqlRes = SqlParser.parse(
      path.join(projectFolder, "src", "db", "schema.sql"),
      projectFolder
    );
    assert.equal(sqlRes.isSupported, true);
    assert.ok(sqlRes.symbols.some(s => s.name === "departments" && s.entityType === "DATABASE_TABLE"));
    assert.ok(sqlRes.symbols.some(s => s.name === "employees" && s.entityType === "DATABASE_TABLE"));
    assert.ok(sqlRes.relations.some(r => r.sourceName === "employees" && r.targetName === "departments" && r.relationType === "REFERENCES_TABLE"));

    // Doc Parser
    const docRes = DocParser.parse(
      path.join(projectFolder, "docs", "ARCHITECTURE.md"),
      projectFolder
    );
    assert.equal(docRes.isSupported, true);
    assert.ok(docRes.relations.some(r => r.targetName === "calculator.py" && r.relationType === "DOCUMENTS"));
    assert.ok(docRes.relations.some(r => r.targetName === "V6.5" && r.relationType === "DOCUMENTS"));
  });

  await t.test("C. Deep Project Indexing Engine Execution", async () => {
    const indexer = new ProjectIndexingEngine(memory, {
      projectId: proj.id,
      projectRoot: projectFolder
    });

    const summary = await indexer.indexProject();

    assert.ok(summary.totalFolders >= 5, `Expected >= 5 folders, got ${summary.totalFolders}`);
    assert.ok(summary.totalFiles >= 6, `Expected >= 6 indexed files, got ${summary.totalFiles}`);
    assert.ok(summary.excludedFiles >= 3, `Expected excluded files >= 3, got ${summary.excludedFiles}`);
    assert.ok(summary.totalEntities >= 12, `Expected total entities >= 12, got ${summary.totalEntities}`);
    assert.ok(summary.totalRelationships >= 10, `Expected relationships >= 10, got ${summary.totalRelationships}`);

    // Check entity diversity
    assert.ok(summary.entityCounts["FOLDER"] > 0, "Missing FOLDER entities");
    assert.ok(summary.entityCounts["CLASS"] > 0, "Missing CLASS entities");
    assert.ok(summary.entityCounts["FUNCTION"] > 0, "Missing FUNCTION entities");
    assert.ok(summary.entityCounts["DATABASE_TABLE"] > 0, "Missing DATABASE_TABLE entities");
    assert.ok(summary.entityCounts["TEST"] > 0, "Missing TEST entities");
    assert.ok(summary.entityCounts["DOCUMENT"] > 0, "Missing DOCUMENT entities");

    // Check relation diversity
    assert.ok(summary.relationCounts["CONTAINS"] > 0, "Missing CONTAINS relations");
    assert.ok(summary.relationCounts["DEFINES"] > 0, "Missing DEFINES relations");
    assert.ok(summary.relationCounts["TESTS"] > 0, "Missing TESTS relations");
  });

  await t.test("D. Incremental Indexing Check: Skip Unchanged Files", async () => {
    const indexer = new ProjectIndexingEngine(memory, {
      projectId: proj.id,
      projectRoot: projectFolder
    });

    // Run indexing again without changing files
    const secondSummary = await indexer.indexProject();
    assert.equal(secondSummary.totalFiles, 7);
    assert.equal(secondSummary.errors.length, 0);

    // Modify one file
    const calcPath = path.join(projectFolder, "src", "payroll", "calculator.py");
    fs.appendFileSync(calcPath, "\ndef new_helper_method():\n    return 42\n");

    const thirdSummary = await indexer.indexProject();
    assert.equal(thirdSummary.totalFiles, 7);

    // Verify new symbol was indexed
    const newHelper = memory.findNodeByNameAndType("new_helper_method", "FUNCTION");
    assert.ok(newHelper, "new_helper_method must be present after modification");
  });

  await t.test("E. Legacy Seed Reconciliation Preservation", () => {
    // Manually add a legacy seed node with manual architecture note
    const legacyNode = memory.addNode({
      entityType: "MODULE",
      name: "calculator.py",
      filePath: "src/payroll/calculator.py",
      summary: "Legacy manual architecture summary for calculator",
      metadata: { provenance: "MANUAL", isManual: true }
    });

    const reconciler = new SeedReconciler(memory);
    const report = reconciler.reconcileLegacySeed([]);

    assert.ok(report.reconciledCount > 0 || report.preservedManualCount > 0);
    const reloaded = memory.getNode(legacyNode.id);
    assert.ok(reloaded, "Legacy seed node must NOT be deleted");
  });

  await t.test("F. Graph Engine Spherical Hierarchy & Filter Verification", () => {
    // Test OVERVIEW view mode
    const overview = graphEngine.exportSphericalGraph({ viewMode: "OVERVIEW" });
    assert.ok(overview.nodes.length > 0);
    assert.ok(overview.nodes.every(n => ["FOLDER", "MODULE", "DATABASE_TABLE", "TASK", "AGENT", "DECISION"].includes(n.type)));

    // Test DATABASE view mode
    const dbView = graphEngine.exportSphericalGraph({ viewMode: "DATABASE" });
    assert.ok(dbView.nodes.length > 0);
    assert.ok(dbView.nodes.every(n => ["DATABASE_TABLE", "MODULE"].includes(n.type)));

    // Test FULL graph
    const full = graphEngine.exportSphericalGraph({ limit: 500 });
    assert.ok(full.nodes.length >= 12);
    assert.ok(full.links.length >= 10);
  });
});
