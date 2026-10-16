/**
 * server/routes/run.js — API endpoints untuk menjalankan script VuGen.
 *
 * Endpoints:
 * - POST /api/run              → Mulai run baru, return { runId }
 * - GET  /api/run/:id/events   → SSE stream event (step, log, transaction, done)
 * - POST /api/run/:id/stop     → Hentikan run
 * - GET  /api/run/:id          → Ambil run.json lengkap
 * - GET  /api/run/:id/step/:seq/body → Ambil body response mentah
 *
 * Orkestrasi run (compile, fork, akumulasi event, saveRun) ada di `runs/execute.js`.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { cacheDirFor, resolveScriptDir } from "../project/paths.js";
import { isValidRunId, loadRun, loadStepBody } from "../runs/store.js";
import { getRun, startRun, stopRun } from "../runs/execute.js";
import { sendJson, sendError, startSse, readJsonBody } from "../http-utils.js";

/**
 * Pastikan runId aman dipakai di path filesystem.
 * @returns {boolean} true bila valid; bila tidak, respons 400 sudah dikirim
 */
function requireRunId(res, runId) {
  if (isValidRunId(runId)) return true;
  sendError(res, 400, "runId tidak valid");
  return false;
}

/**
 * POST /api/run
 * Body: { path: string, options?: RunOptions }
 * Response: { runId: string }
 */
export async function handleRunPost(req, res) {
  const body = await readJsonBody(req);
  if (!body || !body.path) {
    return sendError(res, 400, "Parameter 'path' wajib diisi");
  }

  try {
    const run = await startRun({ scriptDir: body.path, options: body.options });
    sendJson(res, 200, { runId: run.runId });
  } catch (error) {
    if (error.status) throw error;
    sendError(res, 500, `Gagal memulai run: ${error.message}`);
  }
}

/**
 * GET /api/run/:id/events — Server-Sent Events
 */
export async function handleRunEvents(req, res, runId) {
  if (!requireRunId(res, runId)) return;
  const run = getRun(runId);
  if (!run) return sendError(res, 404, `Run ${runId} tidak ditemukan`);

  const sse = startSse(req, res);

  // Replay event yang sudah ada, lalu push event baru.
  for (const event of run.history) sse.send(event.type, event.data);
  if (run.history.some((event) => event.type === "done")) {
    sse.close();
    return;
  }

  const onEvent = (event) => {
    sse.send(event.type, event.data);
    if (event.type === "done") sse.close();
  };
  run.events.on("event", onEvent);
  sse.onClose(() => run.events.off("event", onEvent));
}

/**
 * POST /api/run/:id/stop
 */
export async function handleRunStop(req, res, runId) {
  if (!requireRunId(res, runId)) return;
  if (!stopRun(runId)) {
    return sendError(res, 404, `Run ${runId} tidak ditemukan atau sudah selesai`);
  }
  sendJson(res, 200, { ok: true, message: "Stop signal sent" });
}

/**
 * GET /api/run/:id — Get run.json
 */
export async function handleRunGet(req, res, runId, url) {
  if (!requireRunId(res, runId)) return;

  const scriptDir = url.searchParams.get("path") ? await resolveScriptDir(url.searchParams.get("path")).catch(() => null) : null;
  if (!scriptDir) {
    // Try to find runId in any cache
    const cacheRoot = path.resolve(".cache");
    try {
      const entries = await fs.readdir(cacheRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const cacheDir = path.join(cacheRoot, entry.name);
          const run = await loadRun(cacheDir, runId);
          if (run) return sendJson(res, 200, run);
        }
      }
    } catch {
      // ignore
    }
    return sendError(res, 404, `Run ${runId} tidak ditemukan`);
  }

  const cacheDir = cacheDirFor(scriptDir);
  const run = await loadRun(cacheDir, runId);
  if (!run) return sendError(res, 404, `Run ${runId} tidak ditemukan`);

  sendJson(res, 200, run);
}

/**
 * GET /api/run/:id/step/:seq/body — Get raw response body
 */
export async function handleRunStepBody(req, res, runId, seq, url) {
  if (!requireRunId(res, runId)) return;
  if (!/^[1-9][0-9]*$/.test(String(seq))) return sendError(res, 400, "seq tidak valid");

  const scriptDir = url.searchParams.get("path") ? await resolveScriptDir(url.searchParams.get("path")).catch(() => null) : null;
  if (!scriptDir) {
    return sendError(res, 400, "Parameter 'path' wajib diisi untuk akses body");
  }

  const cacheDir = cacheDirFor(scriptDir);
  const body = await loadStepBody(cacheDir, runId, Number(seq));
  if (!body) return sendError(res, 404, `Body step ${seq} tidak ditemukan`);

  res.setHeader("Content-Type", "application/octet-stream");
  res.end(body);
}

/**
 * Main handler for /api/run/* routes
 * Note: Vite's Connect middleware strips /api prefix, so req.url is /run not /api/run
 */
export async function handleRunRoutes(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Parse path segments (normalized: no /api prefix)
  const segments = pathname.split("/").filter(Boolean);
  // segments: ['run', ':id', 'events'] or ['run', ':id', 'step', ':seq', 'body']

  if (req.method === "POST" && pathname === "/run") {
    return handleRunPost(req, res);
  }

  if (segments.length >= 2 && segments[0] === "run") {
    const runId = segments[1];

    if (req.method === "GET" && segments[2] === "events") {
      return handleRunEvents(req, res, runId);
    }

    if (req.method === "POST" && segments[2] === "stop") {
      return handleRunStop(req, res, runId);
    }

    if (req.method === "GET" && segments.length === 2) {
      return handleRunGet(req, res, runId, url);
    }

    if (req.method === "GET" && segments[2] === "step" && segments[4] === "body") {
      const seq = segments[3];
      return handleRunStepBody(req, res, runId, seq, url);
    }
  }

  sendError(res, 404, "Endpoint tidak ditemukan");
}

export default {
  handleRunPost,
  handleRunEvents,
  handleRunStop,
  handleRunGet,
  handleRunStepBody,
  handleRunRoutes,
};
