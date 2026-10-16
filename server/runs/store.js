/**
 * runs/store.js — Penyimpanan hasil run (plan §7.3).
 *
 * Menulis `run.json` ke folder cache; body response ditulis runner ke
 * `steps/<seq>.body` lewat `saveStepBody` (batas 5 MB, flag `truncated`).
 * Decode body sesuai charset di Content-Type.
 *
 * @typedef {Object} RunOptions
 * @property {number} iterations
 * @property {boolean} continueOnError
 * @property {number} iterationDelayMs
 * @property {boolean} newUserEachIteration
 * @property {boolean} insecureTLS
 * @property {"ignore"|"run"} thinkTime
 * @property {number} timeoutMs
 */

/**
 * @typedef {Object} StepResult
 * @property {number} seq
 * @property {number} iteration
 * @property {string} type - "web_url" | "web_custom_request" | ...
 * @property {string} name
 * @property {string} file
 * @property {number} line
 * @property {string|null} [transaction]
 * @property {string|null} [snapshot] - nama dari `Snapshot=` (metadata saja)
 * @property {Object} request - { method, url, headers, bodyPreview }
 * @property {Object} response - { status, statusText, headers, contentType, size, bodyFile, truncated, redirects }
 * @property {Object} timing - { startMs, durationMs }
 * @property {Object[]} checks - [{ type, text, passed }]
 * @property {string} [error]
 */

/**
 * @typedef {Object} TransactionResult
 * @property {number} iteration
 * @property {string} name
 * @property {string} status - "Pass" | "Fail" | "Auto"
 * @property {number} durationMs
 */

/**
 * @typedef {Object} LogEntry
 * @property {number} ts
 * @property {"info"|"warn"|"error"} level
 * @property {string} msg
 * @property {string} [file]
 * @property {number} [line]
 * @property {number} [iteration]
 */

/**
 * @typedef {Object} RunResult
 * @property {string} runId
 * @property {"passed"|"failed"|"stopped"} status
 * @property {string} startedAt
 * @property {number} durationMs
 * @property {RunOptions} options
 * @property {StepResult[]} steps
 * @property {TransactionResult[]} transactions
 * @property {Record<string, string>} params
 * @property {LogEntry[]} log
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5 MB

/** Format runId dari generateRunId (execute.js): ISO timestamp aman-path + 8 hex. */
const RUN_ID_PATTERN = /^[0-9TZ-]+-[0-9a-f]{8}$/;

/**
 * @param {unknown} runId
 * @returns {boolean}
 */
export function isValidRunId(runId) {
  return typeof runId === "string" && RUN_ID_PATTERN.test(runId);
}

/**
 * @param {unknown} seq
 * @returns {boolean} true bila integer > 0
 */
export function isValidSeq(seq) {
  return Number.isInteger(seq) && /** @type {number} */ (seq) > 0;
}

/**
 * Decode buffer berdasarkan charset dari Content-Type
 * @param {Buffer} buffer
 * @param {string} contentType
 * @returns {string}
 */
export function decodeBody(buffer, contentType) {
  // Extract charset
  let encoding = "utf-8";
  const charsetMatch = contentType?.match(/charset=([^;]+)/i);
  if (charsetMatch) {
    encoding = charsetMatch[1].trim().toLowerCase();
  }

  // Node.js supported encodings
  if (encoding === "iso-8859-1") encoding = "latin1";
  const supported = ["utf-8", "utf8", "ascii", "latin1", "binary", "ucs2", "ucs-2", "utf16le", "utf-16le"];
  if (!supported.includes(encoding)) {
    encoding = "utf-8";
  }

  try {
    return buffer.toString(encoding);
  } catch {
    return buffer.toString("latin1");
  }
}

/**
 * Simpan hasil run ke cache
 * @param {string} cacheDir - Base cache directory
 * @param {string} runId
 * @param {RunResult} runResult
 */
export async function saveRun(cacheDir, runId, runResult) {
  if (!isValidRunId(runId)) throw new Error(`runId tidak valid: ${runId}`);
  const runDir = path.join(cacheDir, "runs", runId);
  await fs.mkdir(runDir, { recursive: true });

  // Tulis atomic: temp → rename
  const runJsonPath = path.join(runDir, "run.json");
  const tmpPath = `${runJsonPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(runResult, null, 2), "utf8");
  await fs.rename(tmpPath, runJsonPath);
}

/**
 * Tulis body response satu step ke `steps/<seq>.body` (dipanggil runner).
 * Lebih dari 5 MB dipotong dan ditandai `truncated`.
 *
 * @param {string} cacheDir
 * @param {string} runId
 * @param {number} seq
 * @param {Buffer} body
 * @returns {Promise<{ bodyFile: string, size: number, truncated: boolean }>}
 */
export async function saveStepBody(cacheDir, runId, seq, body) {
  if (!isValidRunId(runId)) throw new Error(`runId tidak valid: ${runId}`);
  if (!isValidSeq(seq)) throw new Error(`seq tidak valid: ${seq}`);
  const stepsDir = path.join(cacheDir, "runs", runId, "steps");
  await fs.mkdir(stepsDir, { recursive: true });

  const truncated = body.length > MAX_BODY_SIZE;
  await fs.writeFile(path.join(stepsDir, `${seq}.body`), truncated ? body.subarray(0, MAX_BODY_SIZE) : body);
  return { bodyFile: `steps/${seq}.body`, size: body.length, truncated };
}

/**
 * Baca run.json
 * @param {string} cacheDir
 * @param {string} runId
 * @returns {Promise<RunResult|null>}
 */
export async function loadRun(cacheDir, runId) {
  if (!isValidRunId(runId)) return null;
  const runJsonPath = path.join(cacheDir, "runs", runId, "run.json");
  try {
    const content = await fs.readFile(runJsonPath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Baca body file step
 * @param {string} cacheDir
 * @param {string} runId
 * @param {number} seq
 * @returns {Promise<Buffer|null>}
 */
export async function loadStepBody(cacheDir, runId, seq) {
  if (!isValidRunId(runId) || !isValidSeq(seq)) return null;
  const bodyPath = path.join(cacheDir, "runs", runId, "steps", `${seq}.body`);
  try {
    return await fs.readFile(bodyPath);
  } catch {
    return null;
  }
}

/**
 * List all run IDs in cache
 * @param {string} cacheDir
 * @returns {Promise<string[]>}
 */
export async function listRuns(cacheDir) {
  const runsDir = path.join(cacheDir, "runs");
  try {
    const entries = await fs.readdir(runsDir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort((a, b) => b.localeCompare(a)); // newest first
  } catch {
    return [];
  }
}

/**
 * Delete a run
 * @param {string} cacheDir
 * @param {string} runId
 */
export async function deleteRun(cacheDir, runId) {
  if (!isValidRunId(runId)) return;
  const runDir = path.join(cacheDir, "runs", runId);
  await fs.rm(runDir, { recursive: true, force: true });
}

/**
 * Build initial RunResult skeleton
 * @param {Object} params
 * @returns {RunResult}
 */
export function createRunResult({ runId, options }) {
  return {
    runId,
    status: "running",
    startedAt: new Date().toISOString(),
    durationMs: 0,
    options,
    steps: [],
    transactions: [],
    params: {},
    log: [],
  };
}

/**
 * Tambahkan step ke hasil run (data dari event `step` runner).
 * @param {RunResult} runResult
 * @param {Object} stepData - bentuk StepResult (seq & iteration diberi runner)
 * @returns {StepResult}
 */
export function addStep(runResult, stepData) {
  const step = {
    seq: stepData.seq,
    iteration: stepData.iteration || 1,
    type: stepData.type,
    name: stepData.name,
    snapshot: stepData.snapshot || null,
    file: stepData.file || "",
    line: stepData.line || 0,
    transaction: stepData.transaction || null,
    request: stepData.request || { method: "", url: "", headers: {}, bodyPreview: "" },
    response: stepData.response || { status: 0, statusText: "", headers: {}, contentType: "", size: 0, bodyFile: "", truncated: false, redirects: [] },
    timing: stepData.timing || { startMs: 0, durationMs: 0 },
    checks: stepData.checks || [],
    error: stepData.error || null,
  };
  runResult.steps.push(step);
  return step;
}

/**
 * Add transaction to run result
 * @param {RunResult} runResult
 * @param {Object} txData
 */
export function addTransaction(runResult, txData) {
  runResult.transactions.push({
    iteration: txData.iteration || 1,
    name: txData.name,
    status: txData.status || "Auto",
    durationMs: txData.durationMs || 0,
  });
}

/**
 * Add log entry to run result
 * @param {RunResult} runResult
 * @param {LogEntry} logEntry
 */
export function addLog(runResult, logEntry) {
  runResult.log.push({
    ts: logEntry.ts || Date.now(),
    level: logEntry.level || "info",
    msg: logEntry.msg,
    file: logEntry.file,
    line: logEntry.line,
    iteration: logEntry.iteration,
  });
}

/**
 * Finalize run result
 * @param {RunResult} runResult
 * @param {"passed"|"failed"|"stopped"} status
 */
export function finalizeRun(runResult, status) {
  runResult.status = status;
  runResult.durationMs = Date.now() - new Date(runResult.startedAt).getTime();
}

export default {
  saveRun,
  loadRun,
  loadStepBody,
  listRuns,
  deleteRun,
  createRunResult,
  addStep,
  addTransaction,
  addLog,
  finalizeRun,
  decodeBody,
  saveStepBody,
  isValidRunId,
  isValidSeq,
};