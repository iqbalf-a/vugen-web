/**
 * Plugin Vite: mendaftarkan middleware /api dan mengelola siklus hidup
 * child process run (plan §4 aturan 8 — tidak boleh ada proses yatim).
 *
 * @typedef {import("vite").ViteDevServer} ViteDevServer
 */

import { apiRouter } from "./routes/index.js";
import { killAllRuns } from "./runs/registry.js";

/**
 * @param {ViteDevServer} server
 */
function attachApi(server) {
  server.middlewares.use("/api", apiRouter);

  // Vite restart (perubahan vite.config.js) dan SIGINT menutup httpServer.
  server.httpServer?.once("close", () => {
    killAllRuns();
  });

  server.ws?.on?.("close", () => {
    killAllRuns();
  });
}

let exitHookInstalled = false;

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => {
    killAllRuns();
  });
}

/** @returns {import("vite").Plugin} */
export function vugenPlugin() {
  return {
    name: "vugen-web-api",
    // Middleware hanya perlu hidup saat `npm run dev` (plan §3).
    apply: "serve",
    configureServer(server) {
      installExitHook();
      attachApi(server);
      server.config.logger.info("  ➜  VuGen API:  /api/health");
    },
  };
}
