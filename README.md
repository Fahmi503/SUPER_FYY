# SUPER FYY

> Local-first universal AI workspace, project memory engine, and 3D clustered knowledge graph explorer.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D22.0.0-green.svg)](https://nodejs.org)
[![MCP Protocol](https://img.shields.io/badge/Protocol-MCP%20v1.6-purple.svg)](https://modelcontextprotocol.io)

---

## Overview

**SUPER FYY** is an open-source development workspace and memory engine engineered to provide long-term contextual continuity, automated project discovery, and architectural visualization for developers and AI coding agents.

Operating on a strict **local-first** model, SUPER FYY maintains isolated SQLite databases per registered project, exposing rich context via Model Context Protocol (MCP) tools and an interactive 3D Spherical Clustered Knowledge Graph.

---

## Core Capabilities

- **Multi-Project Isolation:** Maintain separate project workspaces, tasks, and memory stores with zero cross-talk.
- **Deep Indexing Engine:** Multi-language parsing (Python AST, TypeScript/JavaScript regex-lexical, SQL DDL, Markdown) that extracts modules, functions, classes, tables, endpoints, and relationships.
- **Hierarchical & Semantic Discovery:** Distinguishes structural hierarchy (`PROJECT_ROOT CONTAINS ...`) from functional dependencies (`CALLS`, `IMPORTS`, `MODIFIES`).
- **3D Spherical Clustered Knowledge Graph:** High-density 3D WebGL visualization built with Three.js, rendering architectural clusters around a central Project Root anchor.
- **Task Lifecycle & Context Handover:** Structured task management with DAG dependency resolution, execution status tracking, and handover capsules across agent sessions.
- **Context Guard & Redaction:** Automated scrubbing of sensitive keys (`password`, `secret`, `token`, `cookie`) and strict boundary enforcement before sending context to models.
- **Full MCP Server Integration:** Standard MCP tool suite enabling AI agents (e.g. Antigravity, Claude, Cursor) to search memory, query topology, register tasks, and acquire locks.

---

## Architecture

```
+--------------------------------------------------------------------------+
|                              SUPER FYY                                   |
+------------------------------------+-------------------------------------+
|         Local Dashboard UI         |             MCP Server              |
|  (Three.js 3D Spherical Graph,     |  (Stdio JSON-RPC Tools, Resources,  |
|   Inspector, Topology Modal)       |   Prompts for AI Coding Agents)     |
+------------------------------------+-------------------------------------+
|                            HTTP & API Server                             |
|        (Cluster Aggregation, Overview Layout, FTS5 Search API)           |
+------------------------------------+-------------------------------------+
|                           Global Engines                                 |
|  +------------------------+----------------------+--------------------+  |
|  | Project Registry       | Deep Indexing Engine | Agent Coordinator  |  |
|  | Task Manager           | Relationship Engine  | Context Guard      |  |
|  +------------------------+----------------------+--------------------+  |
+--------------------------------------------------------------------------+
|                     Local-First Storage Layer                            |
|     (%LOCALAPPDATA%/SuperFyy/projects/{projectId}/memory.db - SQLite)     |
+--------------------------------------------------------------------------+
```

---

## Technology Stack

- **Runtime:** Node.js (v22.0+ recommended, utilizing native `node:sqlite`)
- **Language:** TypeScript 5.4+ (ESM modules)
- **Visualization:** Three.js (r128) + OrbitControls
- **Protocol:** `@modelcontextprotocol/sdk` (v1.6+)
- **Parser Helpers:** Python 3 standard library `ast` module

---

## Getting Started

### Prerequisites

1. **Node.js**: Version 22.0.0 or higher.
2. **Python**: Python 3.8+ (required only if indexing Python source files via AST).
3. **OS**: Windows, macOS, or Linux.

### Installation

```bash
# Clone the repository
git clone https://github.com/Fahmi503/SUPER_FYY.git
cd SUPER_FYY

# Install dependencies
npm install

# Compile TypeScript and bundle assets
npm run build
```

### Running the Synthetic Demo

SUPER FYY includes a pre-packaged synthetic demo workspace (`demo/quantum_flow`) to let you explore the interface and memory tools immediately:

```bash
# Seed the synthetic demo workspace
npm run demo:seed

# Launch the dashboard server
npm start
```

Open your browser to:
```
http://localhost:7700
```

---

## MCP Server Configuration

To connect SUPER FYY with Antigravity, Claude Code, or any MCP-compatible agent, add the server to your agent's MCP settings configuration:

```json
{
  "mcpServers": {
    "super-fyy": {
      "command": "node",
      "args": [
        "C:\\path\\to\\SUPER_FYY\\dist\\mcp\\server.js"
      ]
    }
  }
}
```

### Available MCP Tools

- `superfyy_register_project`: Register a local project directory into the workspace.
- `superfyy_list_projects`: Enumerate all registered projects.
- `superfyy_index_project`: Trigger deep indexing of project source trees.
- `superfyy_search_memory`: Query project memory using SQLite FTS5 full-text search.
- `superfyy_get_spherical_graph`: Retrieve full 3D graph coordinates and topology.
- `superfyy_create_task` & `superfyy_update_task_status`: Manage task DAGs and handovers.
- `superfyy_acquire_lock` & `superfyy_release_lock`: Prevent concurrent agent collisions.

---

## Security & Privacy Model

- **Local-First Immobility:** Memory databases are stored entirely on the local machine (`%LOCALAPPDATA%/SuperFyy/` on Windows). No memory data is transmitted to external servers.
- **Sensitive Key Redaction:** `redactor.ts` strips passwords, secret tokens, and bearer tokens before storing or exporting context.
- **Read-Only Indexing:** Source files are parsed read-only; indexing never writes to or alters inspected project code.

---

## Limitations

- Native `node:sqlite` requires Node.js v22+.
- Python AST extraction requires a local Python 3 interpreter in PATH.
- Complex cross-repository references across distinct project roots are kept within separate memory databases to preserve strict isolation.

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) before submitting pull requests.

---

## License

Distributed under the MIT License. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details.
