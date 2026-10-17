/**
 * runs/registry.js — Satu-satunya registri run yang dikenal server.
 *
 * Dipakai oleh `execute.js` (mendaftarkan run), `routes/run.js` (SSE, stop) dan
 * `vite-plugin.js` (kill semua child saat Vite restart / server close / proses keluar,
 * plan §4 aturan 8).
 *
 * Tidak mengimpor modul lain di server/ supaya tidak ada import sirkular.
 *
 * @typedef {import("node:child_process").ChildProcess} ChildProcess
 * @typedef {import("node:events").EventEmitter} EventEmitter
 * @typedef {Object} RunHandle
 * @property {string} runId
 * @property {ChildProcess} child
 * @property {EventEmitter} events - emit "event" ({ type, data, ts }) untuk tiap event baru
 * @property {{ type: string, data: any, ts: number }[]} history - semua event sejauh ini (replay SSE)
 * @property {Promise<any>} done - resolve setelah saveRun selesai
 * @property {{ file: string, line: number, message: string }[]} warnings
 * @property {boolean} stopRequested
 */

/** Jeda sebelum child dibunuh paksa setelah diminta berhenti */
export const STOP_KILL_DELAY_MS = 1500;
/** Berapa lama run (beserta history event) disimpan di memori setelah selesai */
export const KEEP_AFTER_DONE_MS = 5 * 60 * 1000;

/** @type {Map<string, RunHandle>} */
const runs = new Map();

/** @param {ChildProcess} child */
function isAlive(child) {
  return child.exitCode === null && child.signalCode === null;
}

/** @param {RunHandle} handle */
export function registerRun(handle) {
  runs.set(handle.runId, handle);
}

/**
 * @param {string} runId
 * @returns {RunHandle|undefined}
 */
export function getRun(runId) {
  return runs.get(runId);
}

/**
 * Buang run (dan history event-nya) dari memori setelah jeda.
 * @param {string} runId
 * @param {number} [delayMs]
 */
export function retireRun(runId, delayMs = KEEP_AFTER_DONE_MS) {
  setTimeout(() => runs.delete(runId), delayMs).unref();
}

/**
 * Minta run berhenti: kirim `{type:"stop"}`, bunuh paksa bila belum keluar
 * dalam `STOP_KILL_DELAY_MS`.
 *
 * @param {string} runId
 * @returns {boolean} false bila run tidak ditemukan / child sudah mati
 */
export function stopRun(runId) {
  const run = runs.get(runId);
  if (!run || !isAlive(run.child)) return false;

  run.stopRequested = true;
  try {
    run.child.send({ type: "stop" });
  } catch {
    // IPC sudah tertutup: langsung bunuh di bawah.
  }
  setTimeout(() => {
    if (isAlive(run.child)) run.child.kill();
  }, STOP_KILL_DELAY_MS).unref();
  return true;
}

/**
 * Resume a paused run by sending a resume IPC message to the child.
 * @param {string} runId
 * @returns {boolean} false if run not found or child already dead
 */
export function resumeRun(runId) {
  const run = runs.get(runId);
  if (!run || !isAlive(run.child)) return false;
  try {
    run.child.send({ type: "resume" });
  } catch {
    return false;
  }
  return true;
}

/**
 * Kill semua child yang masih hidup. Dipakai saat server close / Vite restart / proses keluar.
 * @returns {number} jumlah child yang dibunuh
 */
export function killAllRuns() {
  let killed = 0;
  for (const run of runs.values()) {
    if (!isAlive(run.child)) continue;
    try {
      run.child.kill();
      killed++;
    } catch {
      // Proses sudah mati: abaikan.
    }
  }
  return killed;
}

/** @returns {number} jumlah child run yang masih hidup */
export function runningRunCount() {
  let count = 0;
  for (const run of runs.values()) if (isAlive(run.child)) count++;
  return count;
}
