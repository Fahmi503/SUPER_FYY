# Memory Model & Project Isolation

A primary architectural requirement of **SUPER FYY** is strict isolation between multiple software projects on the developer's workstation.

---

## 1. Storage Isolation

Memory databases are physically partitioned on the filesystem:
```
%LOCALAPPDATA%/SuperFyy/
  ├── registry.db              (Global project metadata only)
  └── projects/
      ├── proj_alpha/
      │   └── memory.db        (Alpha entities, edges, FTS5)
      ├── proj_beta/
      │   └── memory.db        (Beta entities, edges, FTS5)
      └── proj_demo_quantum/
          └── memory.db        (Demo entities, edges, FTS5)
```

No cross-project SQL joins or cross-database foreign keys exist. A query executed in `proj_alpha` cannot observe or mutate records in `proj_beta`.

---

## 2. Context Guard & Redaction

Before any content is written to a project memory database or exposed via MCP / API endpoints, it passes through `redactor.ts`:
- Keys matching `/password|token|secret|api_key|cookie|auth_header/i` have their values replaced with `[REDACTED]`.
- Paths outside the registered project canonical root are validated by `path_guard.ts` to prevent path traversal attacks.

---

## 3. Freshness & Invalidation

The memory engine computes cryptographic SHA-256 hashes of tracked files during indexing. If a file changes on disk, its previous memory entity is marked stale or updated incrementally, ensuring agents do not rely on obsolete code understanding.
