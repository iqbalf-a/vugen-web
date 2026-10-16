/**
 * server/routes/run.js — API endpoints untuk menjalankan script VuGen.
 *
 * Endpoints:
 * - POST /api/run              → Mulai run baru, return { runId }
 * - GET  /api/run/:id/events   → SSE stream event (step, log, transaction, done)
 * - POST /api/run/:id/stop     → Hentikan run (kill child process)
 * - GET  /api/run/:id          → Ambil run.json lengkap
 * - GET  /api/run/:id/step/:seq/body → Ambil body response mentah
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fork } from "node:child_process";
import crypto from "node:crypto";

import { cacheDirFor } from "../project/paths.js";
import { loadRun, loadStepBody, loadSnapshotBody, createRunResult, addStep, addTransaction, addLog, addSnapshot, finalizeRun, saveRun } from "../runs/store.js";
import { compileScript } from "../compiler/transpile.js";
import { loadProject } from "../project/loader.js";
import { resolveScriptDir } from "../project/paths.js";
import { sendJson, sendError, startSse, readJsonBody } from "../http-utils.js";

/** Active child processes: runId -> ChildProcess */
const runningChildren = new Map();

/**
 * Generate unique run ID
 */
function generateRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-") + "-" + crypto.randomBytes(4).toString("hex");
}

/**
 * POST /api/run
 * Body: { path: string, options?: RunOptions }
 * Response: { runId: string }
 */
export async function handleRunPost(req, res) {
  try {
    const body = await readJsonBody(req);
    if (!body || !body.path) {
      return sendError(res, 400, "Parameter 'path' wajib diisi");
    }

    const scriptDir = await resolveScriptDir(body.path);
    const project = await loadProject(scriptDir);
    const cacheDir = cacheDirFor(scriptDir);

    // Compile script
    const compileResult = await compileScript({
      scriptDir,
      cacheDir,
      files: project.files,
    });

    const runId = generateRunId();
    const options = {
      iterations: body.options?.iterations ?? 1,
      continueOnError: body.options?.continueOnError ?? false,
      iterationDelayMs: body.options?.iterationDelayMs ?? 0,
      newUserEachIteration: body.options?.newUserEachIteration !== false,
      insecureTLS: body.options?.insecureTLS ?? false,
      thinkTime: body.options?.thinkTime ?? "ignore",
      timeoutMs: body.options?.timeoutMs ?? 60000,
    };

    // Serialize parameter files for runner (Map -> array of [key, value])
    const parameterFiles = project.parameterFiles ? Array.from(project.parameterFiles.entries()) : null;

    // Fork runner process
    const runnerPath = path.resolve("server/runtime/runner.js");
    const child = fork(runnerPath, [], {
      stdio: ["ignore", "ignore", "inherit", "ipc"],
      env: { ...process.env, NODE_ENV: "development" },
    });

    runningChildren.set(runId, child);

    // Create run result to accumulate events
    const runResult = createRunResult({ runId, options });

    // Handle child messages (events)
    child.on("message", (msg) => {
      if (!msg || msg.type !== "event") return;
      const { event } = msg;

      // Store event for SSE clients (skip large/internal events)
      const sseSkipTypes = new Set(["snapshotsComplete", "snapshot", "snapshotMeta"]);
      if (!sseSkipTypes.has(event.type)) {
        if (!pendingEvents.has(runId)) pendingEvents.set(runId, []);
        pendingEvents.get(runId).push(event);
      }

      // Accumulate into runResult
      switch (event.type) {
        case "step": {
          try {
            const stepData = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
            addStep(runResult, stepData, runResult.steps.length + 1, stepData.iteration || 1);
          } catch {
            // ignore parse errors
          }
          break;
        }
        case "transaction": {
          try {
            const txData = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
            addTransaction(runResult, txData);
          } catch {
            // ignore
          }
          break;
        }
        case "log": {
          const level = event.data?.level || "info";
          const msg = event.data?.msg;
          
          // Handle special log levels that carry structured data
          if (level === "step" && msg) {
            try {
              const stepData = typeof msg === "string" ? JSON.parse(msg) : msg;
              addStep(runResult, stepData, runResult.steps.length + 1, stepData.iteration || 1);
            } catch {
              // ignore parse errors
            }
          } else if (level === "transaction" && msg) {
            try {
              const txData = typeof msg === "string" ? JSON.parse(msg) : msg;
              addTransaction(runResult, txData);
            } catch {
              // ignore
            }
          } else {
            // Regular log entry
            addLog(runResult, {
              ts: event.ts || Date.now(),
              level,
              msg,
              file: event.data?.file,
              line: event.data?.line,
            });
          }
          break;
        }
        case "snapshot": {
          // Legacy full snapshot (should not be sent anymore) - skip body to save memory
          const meta = { ...event.data };
          delete meta.data;
          addSnapshot(runResult, { ...meta, response: { ...meta.response, body: undefined } });
          break;
        }
        case "snapshotMeta": {
          // Lightweight snapshot metadata (no body)
          addSnapshot(runResult, event.data);
          break;
        }
        case "snapshotsComplete": {
          // Bulk snapshots with bodies from runner
          if (event.data?.snapshots) {
            for (const snapshot of Object.values(event.data.snapshots)) {
              // Pass cacheDir and runId so body gets saved to disk
              addSnapshot(runResult, snapshot, cacheDir, runId);
            }
          }
          break;
        }
        case "done": {
          const status = event.data?.status || (event.data?.passed ? "passed" : "failed");
          finalizeRun(runResult, status);
          saveRun(cacheDir, runId, runResult).catch((err) => {
            console.error(`[run] Failed to save run ${runId}:`, err);
          });
          break;
        }
        case "error": {
          // Log error but don't fail run yet
          addLog(runResult, {
            ts: event.ts || Date.now(),
            level: "error",
            msg: event.data?.message || "Runner error",
          });
          break;
        }
      }
    });

    child.on("exit", (code) => {
      runningChildren.delete(runId);
      // If run didn't complete gracefully, finalize with failure
      if (runResult.status === "running") {
        const status = code === 0 ? "passed" : "failed";
        finalizeRun(runResult, status);
        saveRun(cacheDir, runId, runResult).catch((err) => {
          console.error(`[run] Failed to save run ${runId}:`, err);
        });
      }
      // Send done event if not already sent
      const events = pendingEvents.get(runId) || [];
      const hasDone = events.some(e => e.type === "done");
      if (!hasDone) {
        events.push({ type: "done", data: { runId, status: runResult.status }, ts: Date.now() });
      }
    });

    // Start run
    child.send({
      type: "start",
      payload: {
        modulePath: compileResult.modulePath,
        scriptDir,
        cacheDir,
        options,
        runId,
        parameterFiles,
        runLogic: project.runLogic,
      },
    });

    sendJson(res, 200, { runId });
  } catch (error) {
    if (error.status) throw error;
    sendError(res, 500, `Gagal memulai run: ${error.message}`);
  }
}

/** In-memory event store for SSE (per runId) */
const pendingEvents = new Map();

/**
 * GET /api/run/:id/debug — Debug pending events
 */
export async function handleRunDebug(req, res, runId) {
  const events = pendingEvents.get(runId) || [];
  sendJson(res, 200, { 
    runId, 
    eventCount: events.length, 
    events: events.map(e => ({ 
      type: e.type, 
      level: e.data?.level, 
      actions: e.data?.actions,
      dataKeys: e.data ? Object.keys(e.data) : [],
      ts: e.ts 
    })) 
  });
}

/**
 * GET /api/run/:id/events — Server-Sent Events
 */
export async function handleRunEvents(req, res, runId) {
  const child = runningChildren.get(runId);
  if (!child && !pendingEvents.has(runId)) {
    return sendError(res, 404, `Run ${runId} tidak ditemukan`);
  }

  startSse(req, res);

  // Send existing events
  const events = pendingEvents.get(runId) || [];
  for (const event of events) {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event.data)}\n\n`);
  }

  // Track new events
  let eventIndex = events.length;

  const interval = setInterval(() => {
    const currentEvents = pendingEvents.get(runId) || [];
    while (eventIndex < currentEvents.length) {
      const event = currentEvents[eventIndex];
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event.data)}\n\n`);
      eventIndex++;
    }

    // Send heartbeat comment
    res.write(": heartbeat\n\n");
  }, 1000);

  // Cleanup on close
  req.on("close", () => {
    clearInterval(interval);
  });

  // Also listen for 'done' to auto-close (flush all pending events first)
  const doneHandler = (msg) => {
    if (msg?.type === "event" && msg.event?.type === "done") {
      clearInterval(interval);
      // Flush any remaining events before closing (but skip if already sent done)
      const currentEvents = pendingEvents.get(runId) || [];
      while (eventIndex < currentEvents.length) {
        const event = currentEvents[eventIndex];
        // Skip done event here - we'll send it below
        if (event.type !== "done") {
          res.write(`event: ${event.type}\n`);
          res.write(`data: ${JSON.stringify(event.data)}\n\n`);
        }
        eventIndex++;
      }
      // Send the done event
      res.write(`event: done\n`);
      res.write(`data: ${JSON.stringify(msg.event.data)}\n\n`);
      res.end();
    }
  };
  child?.on("message", doneHandler);
  req.on("close", () => child?.off("message", doneHandler));
}

/**
 * POST /api/run/:id/stop — Kill child process
 */
export async function handleRunStop(req, res, runId) {
  const child = runningChildren.get(runId);
  if (!child) {
    return sendError(res, 404, `Run ${runId} tidak ditemukan atau sudah selesai`);
  }

  child.send({ type: "stop" });

  // Force kill after 2 seconds
  setTimeout(() => {
    if (runningChildren.has(runId)) {
      child.kill("SIGKILL");
      runningChildren.delete(runId);
    }
  }, 2000);

  sendJson(res, 200, { ok: true, message: "Stop signal sent" });
}

/**
 * GET /api/run/:id — Get run.json
 */
export async function handleRunGet(req, res, runId, url) {
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
  const scriptDir = url.searchParams.get("path") ? await resolveScriptDir(url.searchParams.get("path")).catch(() => null) : null;
  if (!scriptDir) {
    return sendError(res, 400, "Parameter 'path' wajib diisi untuk akses body");
  }

  const cacheDir = cacheDirFor(scriptDir);
  const body = await loadStepBody(cacheDir, runId, parseInt(seq, 10));
  if (!body) return sendError(res, 404, `Body step ${seq} tidak ditemukan`);

  res.setHeader("Content-Type", "application/octet-stream");
  res.end(body);
}

/**
 * GET /api/run/:id/snapshot/:name/body — Get raw snapshot response body
 */
export async function handleRunSnapshotBody(req, res, runId, name, url) {
  const scriptDir = url.searchParams.get("path") ? await resolveScriptDir(url.searchParams.get("path")).catch(() => null) : null;
  if (!scriptDir) {
    return sendError(res, 400, "Parameter 'path' wajib diisi untuk akses body snapshot");
  }

  const cacheDir = cacheDirFor(scriptDir);
  const body = await loadSnapshotBody(cacheDir, runId, name);
  if (!body) return sendError(res, 404, `Body snapshot ${name} tidak ditemukan`);

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
      return handleRunEvents(req, res, runId, url);
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

    if (req.method === "GET" && segments[2] === "snapshot" && segments[4] === "body") {
      const name = segments[3];
      return handleRunSnapshotBody(req, res, runId, name, url);
    }

    if (req.method === "GET" && segments[2] === "debug") {
      return handleRunDebug(req, res, runId);
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
  handleRunSnapshotBody,
  handleRunRoutes,
};