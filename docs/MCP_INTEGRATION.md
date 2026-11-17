# Model Context Protocol (MCP) Integration

SUPER FYY implements the official **Model Context Protocol (MCP)** v1.6 specification over stdio. This enables AI assistants (such as Google Antigravity, Anthropic Claude Code, Cursor, and Windsurf) to query project memory and trigger indexing autonomously.

---

## 1. Configuring MCP Clients

Add SUPER FYY to your client's MCP configuration:

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

---

## 2. Supported Tools

### Project Management
- `superfyy_register_project`: Register a local directory.
- `superfyy_list_projects`: List all registered workspaces.
- `superfyy_get_project`: Retrieve project details and database paths.

### Indexing & Graph
- `superfyy_index_project`: Run deep file-level AST indexing.
- `superfyy_get_indexing_status`: Check indexing status and entity counts.
- `superfyy_get_spherical_graph`: Fetch full 3D graph coordinates.
- `superfyy_impact_analysis`: Compute upstream and downstream impact trees.

### Memory & Search
- `superfyy_search_memory`: Execute FTS5 text searches against entities and summaries.
- `superfyy_add_entity`: Register custom entities manually.
- `superfyy_connect_entities`: Add directed relationships.

### Task & Decision Engine
- `superfyy_create_task`: Create a task in the project DAG.
- `superfyy_update_task_status`: Update task status (`PENDING`, `IN_PROGRESS`, `COMPLETED`, `BLOCKED`).
- `superfyy_get_task_handover`: Retrieve task handover summaries and context capsules.
- `superfyy_record_decision`: Log architectural decisions with rationales and constraints.
