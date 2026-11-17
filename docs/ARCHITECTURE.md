# Architecture Overview

SUPER FYY is built on a modular, local-first layered architecture designed for speed, resilience, and privacy.

---

## 1. Layers

```
+--------------------------------------------------------------+
|                         Interface Layer                      |
|   Dashboard UI (Three.js 3D Graph) | MCP Server (JSON-RPC)   |
+--------------------------------------------------------------+
|                        Execution Layer                       |
|   Launcher | Desktop Server | API Router | FTS5 Search API   |
+--------------------------------------------------------------+
|                       Intelligence Layer                     |
|   Indexing Engine | Relationship Engine | Decision Ledger    |
|   Context Guard   | Task Manager        | Coordinator        |
+--------------------------------------------------------------+
|                          Data Layer                          |
|   Project Registry (global.db) | Project Memory (memory.db)  |
+--------------------------------------------------------------+
```

---

## 2. Core Subsystems

### Project Registry
Maintains global registration of all tracked project roots. Each project receives a unique ID, technology classification, and an isolated SQLite memory database path.

### Memory & Storage Engine
Each project is allocated its own database (`%LOCALAPPDATA%/SuperFyy/projects/{id}/memory.db`). Tables store:
- `entities`: Nodes (modules, classes, functions, tables, tasks, decisions).
- `edges`: Directed relationships with typed semantics.
- `fts_entities`: Full-text search index powered by SQLite FTS5.
- `tasks` & `task_dependencies`: Task DAG management.
- `decisions`: Architectural decision ledger.

### Deep Indexing Engine
Scans project files while respecting ignore patterns. Employs language-specific parsers:
- **Python**: Uses AST extractor script to map classes, functions, decorators, imports.
- **TypeScript / JavaScript**: Lexical extraction of classes, functions, exports, imports.
- **SQL**: DDL parser extracting `CREATE TABLE`, primary keys, and foreign keys.
- **Markdown / Docs**: Header and section relationship extraction.

### Knowledge Graph Presentation
Transforms raw entities and edges into clustered spherical coordinates centered on a stable `PROJECT_ROOT` node at `(0, 0, 0)`. Structural containment (`CONTAINS`) forms primary cluster groupings, while functional links (`CALLS`, `IMPORTS`, `MODIFIES`) provide cross-cluster visibility.
