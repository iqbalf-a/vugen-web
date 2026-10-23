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

import { runCacheDirFor, resolveScriptDir } from "../project/paths.js";
import { isValidRunId, loadRun, loadStepBody } from "../runs/store.js";
import { startRun } from "../runs/execute.js";
import { getRun, stopRun, resumeRun } from "../runs/registry.js";
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
    const run = await startRun({ scriptDir: body.path, options: body.options, profile: req.profile ?? "_" });
    sendJson(res, 200, { runId: run.runId });
  } catch (error) {
    if (error.status) throw error;
    sendError(res, 500, `Gagal memulai run: ${error.message}`);
  }
}

/**
 * GET /api/run/:id/events — Server-Sent Events
 */
export async function handleRunEvents(req, res, _url, { id: runId }) {
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
export async function handleRunStop(req, res, _url, { id: runId }) {
  if (!requireRunId(res, runId)) return;
  if (!stopRun(runId)) {
    return sendError(res, 404, `Run ${runId} tidak ditemukan atau sudah selesai`);
  }
  sendJson(res, 200, { ok: true, message: "Stop signal sent" });
}

/**
 * POST /api/run/:id/resume
 */
export async function handleRunResume(req, res, _url, { id: runId }) {
  if (!requireRunId(res, runId)) return;
  if (!resumeRun(runId)) {
    return sendError(res, 404, `Run ${runId} not found or already finished`);
  }
  sendJson(res, 200, { ok: true });
}

/**
 * GET /api/run/:id — Get run.json
 */
export async function handleRunGet(req, res, url, { id: runId }) {
  if (!requireRunId(res, runId)) return;

  const scriptDir = url.searchParams.get("path") ? await resolveScriptDir(url.searchParams.get("path")).catch(() => null) : null;
  if (!scriptDir) return sendError(res, 400, "Parameter 'path' wajib diisi");

  const cacheDir = runCacheDirFor(scriptDir, req.profile ?? "_");
  const run = await loadRun(cacheDir, runId);
  if (!run) return sendError(res, 404, `Run ${runId} tidak ditemukan`);

  sendJson(res, 200, run);
}

/**
 * GET /api/run/:id/step/:seq/body — Get raw response body
 */
export async function handleRunStepBody(req, res, url, { id: runId, seq }) {
  if (!requireRunId(res, runId)) return;
  if (!/^[1-9][0-9]*$/.test(String(seq))) return sendError(res, 400, "seq tidak valid");

  const scriptDir = url.searchParams.get("path") ? await resolveScriptDir(url.searchParams.get("path")).catch(() => null) : null;
  if (!scriptDir) {
    return sendError(res, 400, "Parameter 'path' wajib diisi untuk akses body");
  }

  const cacheDir = runCacheDirFor(scriptDir, req.profile ?? "_");
  const body = await loadStepBody(cacheDir, runId, Number(seq));
  if (!body) return sendError(res, 404, `Body step ${seq} tidak ditemukan`);

  res.setHeader("Content-Type", "application/octet-stream");
  res.end(body);
}
