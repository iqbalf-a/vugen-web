/**
 * runs/execute.js — Orkestrasi satu run: compile → fork runner → akumulasi event → saveRun.
 *
 * Satu-satunya tempat yang menerjemahkan event runner menjadi `RunResult`;
 * dipakai oleh `routes/run.js` (UI) dan `test/run-cli.js` (CLI).
 *
 * Event ke pendengar (`events`/`history`) berbentuk `{ type, data, ts }`.
 * Event `done` baru dikirim SETELAH `saveRun` selesai, sehingga klien yang
 * langsung membaca `run.json` tidak kena race.
 */

import { fork } from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";

import { compileScript } from "../compiler/transpile.js";
import { loadProject } from "../project/loader.js";
import { cacheDirFor, resolveScriptDir } from "../project/paths.js";
import { KEEP_AFTER_DONE_MS, registerRun, retireRun } from "./registry.js";
import { addLog, addStep, addTransaction, createRunResult, finalizeRun, saveRun } from "./store.js";

const RUNNER_PATH = fileURLToPath(new URL("../runtime/runner.js", import.meta.url));

/**
 * @typedef {import("./store.js").RunResult} RunResult
 * @typedef {import("./store.js").RunOptions} RunOptions
 * @typedef {{ type: string, data: any, ts: number }} RunEvent
 * @typedef {import("./registry.js").RunHandle} RunHandle
 */

/** @returns {string} runId, cocok dengan `isValidRunId` */
export function generateRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-") + "-" + crypto.randomBytes(4).toString("hex");
}

/**
 * @param {Partial<RunOptions>} [options]
 * @returns {RunOptions}
 */
function normalizeOptions(options = {}) {
  return {
    iterations: options.iterations ?? 1,
    continueOnError: options.continueOnError ?? false,
    iterationDelayMs: options.iterationDelayMs ?? 0,
    newUserEachIteration: options.newUserEachIteration !== false,
    insecureTLS: options.insecureTLS ?? false,
    thinkTime: options.thinkTime ?? "ignore",
    timeoutMs: options.timeoutMs ?? 60000,
  };
}

/**
 * Compile script lalu jalankan di child process.
 *
 * @param {{ scriptDir: string, options?: Partial<RunOptions> }} params
 * @returns {Promise<RunHandle>}
 */
export async function startRun({ scriptDir, options = {} }) {
  const dir = await resolveScriptDir(scriptDir);
  const project = await loadProject(dir);
  const cacheDir = cacheDirFor(dir);
  await fs.mkdir(cacheDir, { recursive: true });

  const compileResult = await compileScript({ scriptDir: dir, cacheDir, files: project.files });

  const runId = generateRunId();
  const runOptions = normalizeOptions(options);
  const runResult = createRunResult({ runId, options: runOptions });

  const events = new EventEmitter();
  /** @type {RunEvent[]} */
  const history = [];
  let finished = false;

  /** @param {string} type @param {any} data @param {number} [ts] */
  const emit = (type, data, ts = Date.now()) => {
    const event = { type, data, ts };
    history.push(event);
    events.emit("event", event);
  };

  const child = fork(RUNNER_PATH, [], { stdio: ["ignore", "ignore", "inherit", "ipc"] });

  /** @type {(result: RunResult) => void} */
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  /**
   * Tutup run: simpan run.json, baru kirim event "done".
   * @param {"passed"|"failed"|"stopped"} status
   * @param {Record<string, string>} [params]
   */
  async function finish(status, params) {
    if (finished) return;
    finished = true;

    finalizeRun(runResult, status);
    if (params) runResult.params = params;
    try {
      await saveRun(cacheDir, runId, runResult);
    } catch (error) {
      addLog(runResult, { level: "error", msg: `Gagal menyimpan run: ${error.message}` });
      emit("log", { level: "error", msg: `Gagal menyimpan run: ${error.message}` });
    }

    emit("done", { runId, status });
    resolveDone(runResult);

    if (child.exitCode === null) child.kill();
    retireRun(runId, KEEP_AFTER_DONE_MS);
  }

  child.on("message", (msg) => {
    if (!msg || msg.type !== "event") return;
    const { event } = msg;

    switch (event.type) {
      case "ready":
        child.send({
          type: "start",
          payload: {
            modulePath: compileResult.modulePath,
            scriptDir: dir,
            cacheDir,
            options: runOptions,
            runId,
            parameters: project.parameters,
            runLogic: project.runLogic,
          },
        });
        return;

      case "step":
        addStep(runResult, event.data);
        break;

      case "transaction":
        addTransaction(runResult, event.data);
        break;

      case "log":
        addLog(runResult, { ts: event.ts, ...event.data });
        break;

      case "error":
        addLog(runResult, { ts: event.ts, level: "error", msg: event.data?.message || "Runner error" });
        break;

      case "done":
        void finish(event.data?.status === "passed" ? "passed" : "failed", event.data?.params);
        return;

      case "stopped":
        emit(event.type, event.data, event.ts);
        void finish("stopped");
        return;
    }

    emit(event.type, event.data, event.ts);
  });

  child.on("error", (error) => {
    addLog(runResult, { level: "error", msg: `Child process error: ${error.message}` });
    void finish("failed");
  });

  child.on("exit", (code) => {
    // Keluar tanpa event done (crash / dibunuh): run dianggap gagal
    void finish(handle.stopRequested ? "stopped" : code === 0 ? "passed" : "failed");
  });

  /** @type {RunHandle} */
  const handle = { runId, child, events, history, done, warnings: compileResult.warnings, stopRequested: false };
  registerRun(handle);
  return handle;
}

export default { startRun, generateRunId };
