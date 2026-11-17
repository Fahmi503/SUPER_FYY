import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ProjectRegistry } from "../core/registry/project_registry.js";
import { ProjectMemory } from "../core/memory/project_memory.js";
import { GraphEngine } from "../core/graph/graph_engine.js";
import { GraphPresentation } from "../core/graph/graph_presentation.js";
import { TaskManager } from "../core/tasks/task_manager.js";
import { AgentRegistry, BUILTIN_AGENT_PROFILES } from "../core/agents/agent_registry.js";
import { ContextBuilder } from "../core/memory/context_builder.js";
import { ProjectIndexingEngine } from "../core/indexing/indexing_engine.js";

export class DashboardServer {
  private registry: ProjectRegistry;
  private server: http.Server;
  private memoryCache: Map<string, { memory: ProjectMemory; graph: GraphEngine; tasks: TaskManager; agents: AgentRegistry }> = new Map();
  public readonly publicDir: string;

  constructor(customDataDir?: string, publicDir?: string) {
    this.registry = new ProjectRegistry(customDataDir);
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const distPublic = path.resolve(__dirname, "public");
    const srcPublic = path.resolve(__dirname, "../../src/dashboard/public");
    const cwdPublic = path.resolve(process.cwd(), "src/dashboard/public");

    this.publicDir = publicDir || (fs.existsSync(distPublic) ? distPublic : (fs.existsSync(srcPublic) ? srcPublic : cwdPublic));

    this.server = http.createServer(this.handleRequest.bind(this));
  }

  private getContext(projectId: string) {
    const project = this.registry.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    if (this.memoryCache.has(project.id)) {
      return this.memoryCache.get(project.id)!;
    }

    const memory = new ProjectMemory(project.memory_db_path, project.id);
    const graph = new GraphEngine(memory);
    const tasks = new TaskManager(memory.getRawDb(), project.id);
    const agents = new AgentRegistry(memory.getRawDb());

    const ctx = { memory, graph, tasks, agents };
    this.memoryCache.set(project.id, ctx);
    return ctx;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // API Routes
      if (pathname === "/api/projects" && req.method === "GET") {
        const list = this.registry.listProjects(false);
        this.json(res, 200, { projects: list });
        return;
      }

      if (pathname === "/api/agents" && req.method === "GET") {
        this.json(res, 200, { profiles: BUILTIN_AGENT_PROFILES });
        return;
      }

      // Project-specific routes: /api/projects/:id/...
      const projMatch = pathname.match(/^\/api\/projects\/([^/]+)(\/(graph|tasks|activities|search|context|index|connectivity))?$/);
      if (projMatch) {
        const projectId = projMatch[1];
        const subroute = projMatch[3];
        const project = this.registry.getProject(projectId);
        if (!project) {
          this.json(res, 404, { error: "Project not found" });
          return;
        }

        if (subroute === "graph" && req.method === "GET" && url.searchParams.get("mode") === "overview") {
          const ctx = this.getContext(projectId);
          const presentation = new GraphPresentation(ctx.memory);
          this.json(res, 200, presentation.getOverview(project.name));
          return;
        }

        if (subroute === "connectivity" && req.method === "GET") {
          const ctx = this.getContext(projectId);
          const presentation = new GraphPresentation(ctx.memory);
          const ov = presentation.getOverview(project.name);
          this.json(res, 200, {
            projectId: project.id,
            projectName: project.name,
            connectivity: ov.connectivity,
            aggregatedEdges: ov.links
          });
          return;
        }

        if (!subroute && req.method === "GET") {
          this.json(res, 200, { project });
          return;
        }

        const ctx = this.getContext(projectId);

        if (subroute === "index") {
          if (req.method === "POST") {
            const indexer = new ProjectIndexingEngine(ctx.memory, {
              projectId: project.id,
              projectRoot: project.canonical_path
            });
            const summary = await indexer.indexProject();
            this.json(res, 200, { success: true, summary });
            return;
          }

          if (req.method === "GET") {
            const indexedFiles = ctx.memory.listIndexedFiles();
            const graph = ctx.memory.getGraph({ limit: 10000 });
            const counts: Record<string, number> = {};
            for (const n of graph.nodes) {
              counts[n.entity_type] = (counts[n.entity_type] || 0) + 1;
            }
            this.json(res, 200, {
              projectId: project.id,
              totalIndexedFiles: indexedFiles.length,
              totalNodes: graph.nodes.length,
              totalEdges: graph.edges.length,
              entityCounts: counts,
              indexedFiles: indexedFiles.slice(0, 50)
            });
            return;
          }
        }

        if (subroute === "context" && req.method === "GET") {
          const query = String(url.searchParams.get("query") || "current session");
          const taskId = url.searchParams.get("task_id") || undefined;
          const builder = new ContextBuilder(ctx.memory);
          const pkg = builder.buildContextPackage({ userInstruction: query, taskId });
          this.json(res, 200, pkg);
          return;
        }

        if (subroute === "graph" && req.method === "GET") {
          const mode = url.searchParams.get("mode");
          const presentation = new GraphPresentation(ctx.memory);
          if (mode === "cluster") {
            const clusterId = String(url.searchParams.get("cluster") || "");
            const offset = Number(url.searchParams.get("offset")) || 0;
            const limit = Number(url.searchParams.get("limit")) || 36;
            const typesParam = url.searchParams.get("types");
            const types = typesParam !== null ? typesParam.split(",").filter(Boolean).map(type => type.toUpperCase()) as any[] : undefined;
            this.json(res, 200, presentation.getCluster(clusterId, { offset, limit, types }));
            return;
          }
          if (mode === "entity") {
            const entityId = String(url.searchParams.get("entity") || "");
            const p = this.registry.getProject(projectId);
            if (!p) { this.json(res, 404, { error: "Project not found" }); return; }
            this.json(res, 200, presentation.getEntityDetail(entityId, p.name));
            return;
          }
          const radius = Number(url.searchParams.get("radius")) || 350;
          const limit = Number(url.searchParams.get("limit")) || 1000;
          const viewMode = (url.searchParams.get("view") || undefined) as any;
          const typesParam = url.searchParams.get("types");
          const entityTypes = typesParam ? (typesParam.split(",") as any) : undefined;
          const focusPath = url.searchParams.get("focus") || undefined;

          const graphData = ctx.graph.exportSphericalGraph({
            sphereRadius: radius,
            limit,
            viewMode,
            entityTypes,
            focusPath
          });
          this.json(res, 200, graphData);
          return;
        }

        if (subroute === "tasks" && req.method === "GET") {
          const list = ctx.tasks.listTasks();
          this.json(res, 200, { tasks: list });
          return;
        }

        if (subroute === "activities" && req.method === "GET") {
          const limit = Number(url.searchParams.get("limit")) || 30;
          const acts = ctx.agents.getRecentActivities(projectId, limit);
          this.json(res, 200, { activities: acts });
          return;
        }

        if (subroute === "search" && req.method === "POST") {
          const body = await this.readBodyJson(req);
          const query = String(body.query || "");
          const limit = Number(body.limit) || 20;
          const nodes = ctx.memory.searchFts(query, limit);
          this.json(res, 200, { results: nodes });
          return;
        }
      }

      // Static Files
      let filePath = path.join(this.publicDir, pathname === "/" ? "index.html" : pathname);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          ".html": "text/html",
          ".js": "application/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".svg": "image/svg+xml"
        };
        res.setHeader("Content-Type", mimeTypes[ext] || "text/plain");
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      this.json(res, 404, { error: "Not Found" });
    } catch (err: any) {
      const message = err.message || String(err);
      const status = message === "Entity not found" || message === "Cluster not found" || message === "Unknown cluster id"
        ? 404
        : message === "Invalid cluster path" ? 400 : 500;
      this.json(res, status, { error: message });
    }
  }

  private json(res: http.ServerResponse, code: number, data: unknown): void {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  private readBodyJson(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", chunk => (data += chunk));
      req.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(new Error("Invalid JSON body"));
        }
      });
      req.on("error", reject);
    });
  }

  public listen(port: number = 7700, host: string = "127.0.0.1"): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => {
        this.server.removeListener("error", reject);
        const addr = this.server.address();
        const actualPort = typeof addr === "object" && addr ? addr.port : port;
        resolve(actualPort);
      });
    });
  }

  public close(): Promise<void> {
    for (const ctx of this.memoryCache.values()) {
      try {
        ctx.memory.close();
      } catch {}
    }
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}
