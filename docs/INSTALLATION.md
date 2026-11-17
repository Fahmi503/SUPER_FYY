# Installation & Setup Guide

This guide walks you through setting up and running **SUPER FYY** on your local machine.

---

## 1. System Requirements

- **Node.js**: `v22.0.0` or higher (Node 22 provides built-in `node:sqlite`).
- **npm**: `v10.0.0` or higher.
- **Python**: `3.8+` (optional, required only for extracting Python AST metadata during indexing).
- **Git**: Installed and accessible in PATH.

---

## 2. Quick Setup

```bash
# 1. Clone repository
git clone https://github.com/Fahmi503/SUPER_FYY.git
cd SUPER_FYY

# 2. Install dependencies
npm install

# 3. Build project
npm run build

# 4. Run tests to verify environment
npm test

# 5. Seed synthetic demo project
npm run demo:seed

# 6. Start the dashboard
npm start
```

Once running, navigate to `http://localhost:7700` in your web browser.

---

## 3. Directory Layout

- `src/core/`: Engines for memory, indexing, graph, tasks, agents, and security.
- `src/dashboard/`: Express HTTP server and frontend 3D WebGL interface.
- `src/mcp/`: Model Context Protocol server.
- `dist/`: Compiled JavaScript output and bundled static assets.
- `demo/`: Synthetic demonstration workspace (`quantum_flow`).
