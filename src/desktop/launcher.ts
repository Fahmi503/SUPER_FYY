import { DashboardServer } from "../dashboard/server.js";
import { exec } from "node:child_process";
import path from "node:path";

async function main() {
  const port = Number(process.env.PORT) || 7700;
  const server = new DashboardServer();

  const actualPort = await server.listen(port);
  const url = `http://localhost:${actualPort}`;

  console.log("=================================================");
  console.log("   SUPER FYY — Universal AI Workspace & Memory   ");
  console.log("=================================================");
  console.log(`[STATUS] Dashboard Server running at: ${url}`);
  console.log(`[STORAGE] Global Data: %LOCALAPPDATA%\\SuperFyy`);
  console.log(`[INTEGRATION] Antigravity MCP Server: C:\\SUPER_FYY\\dist\\mcp\\server.js`);
  console.log("=================================================");

  // Launch browser if not running in headless mode
  if (process.env.HEADLESS !== "true") {
    const startCmd = process.platform === "win32" ? `start ${url}` : `xdg-open ${url}`;
    exec(startCmd, (err) => {
      if (err) console.error("Failed to auto-open browser:", err.message);
    });
  }

  const shutdown = async () => {
    console.log("\nShutting down Super Fyy desktop services...");
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Super Fyy launch error:", err);
  process.exit(1);
});
