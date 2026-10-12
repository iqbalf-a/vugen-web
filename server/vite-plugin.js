/**
 * Plugin Vite: mendaftarkan middleware /api dan mengelola siklus hidup
 * child process run (plan §4 aturan 8 — tidak boleh ada proses yatim).
 *
 * @typedef {import("node:child_process").ChildProcess} ChildProcess
 * @typedef {import("vite").ViteDevServer} ViteDevServer
 */

import { apiRouter } from "./routes/index.js";

/** @type {Map<string, ChildProcess>} */
const runningChildren = new Map();

/** Daftarkan child process run agar bisa di-Stop dan dibersihkan. */
export function registerRun(runId, child) {
  runningChildren.set(runId, child);
  child.once("exit", () => {
    if (runningChildren.get(runId) === child) runningChildren.delete(runId);
  });
}

/** Hentikan satu run. Kembalikan true bila ada proses yang dihentikan. */
export function stopRun(runId) {
  const child = runningChildren.get(runId);
  if (!child) return false;
  runningChildren.delete(runId);
  try {
    child.kill();
  } catch {
    // Proses sudah mati: abaikan.
  }
  return true;
}

/** Kill semua child run. Dipakai saat server close / Vite restart / proses keluar. */
export function killAllRuns() {
  const children = [...runningChildren.values()];
  runningChildren.clear();
  for (const child of children) {
    try {
      child.kill();
    } catch {
      // Proses sudah mati: abaikan.
    }
  }
  return children.length;
}

/** @returns {number} jumlah child run yang masih hidup */
export function runningRunCount() {
  return runningChildren.size;
}

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
