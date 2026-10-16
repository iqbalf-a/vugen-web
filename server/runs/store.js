/**
 * runs/store.js — Penyimpanan hasil run (plan §7.3).
 *
 * Menulis `run.json` + `steps/<seq>.body` ke folder cache.
 * Body response disimpan terpisah (batas 5 MB, flag `truncated`).
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
 * @property {string} [transaction]
 * @property {Object} request - { method, url, headers, bodyPreview }
 * @property {Object} response - { status, statusText, headers, contentType, size, bodyFile, truncated }
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

/**
 * Decode buffer berdasarkan charset dari Content-Type
 * @param {Buffer} buffer
 * @param {string} contentType
 * @returns {string}
 */
function decodeBody(buffer, contentType) {
  // Extract charset
  let encoding = "utf-8";
  const charsetMatch = contentType?.match(/charset=([^;]+)/i);
  if (charsetMatch) {
    encoding = charsetMatch[1].trim().toLowerCase();
  }

  // Node.js supported encodings
  const supported = ["utf-8", "utf8", "ascii", "latin1", "binary", "base64", "hex", "ucs2", "ucs-2", "utf16le", "utf-16le"];
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
  const runDir = path.join(cacheDir, "runs", runId);
  const stepsDir = path.join(runDir, "steps");
  const snapshotsDir = path.join(runDir, "snapshots");

  await fs.mkdir(stepsDir, { recursive: true });
  await fs.mkdir(snapshotsDir, { recursive: true });

  // Save step body files and update step references
  for (const step of runResult.steps) {
    if (step.response?.body) {
      const bodyBuffer = step.response.body instanceof Buffer
        ? step.response.body
        : Buffer.from(step.response.body);

      const truncated = bodyBuffer.length > MAX_BODY_SIZE;
      const bodyToSave = truncated ? bodyBuffer.subarray(0, MAX_BODY_SIZE) : bodyBuffer;

      const bodyFileName = `${step.seq}.body`;
      const bodyPath = path.join(stepsDir, bodyFileName);
      await fs.writeFile(bodyPath, bodyToSave);

      step.response.bodyFile = bodyFileName;
      step.response.truncated = truncated;
      step.response.size = bodyBuffer.length;

      // Remove buffer from JSON (keep only metadata)
      delete step.response.body;
    }
  }

  // Save snapshot body files and update snapshot references
  if (runResult.snapshots) {
    for (const [name, snapshot] of Object.entries(runResult.snapshots)) {
      if (snapshot.response?.body) {
        const bodyBuffer = snapshot.response.body instanceof Buffer
          ? snapshot.response.body
          : Buffer.from(snapshot.response.body);

        const truncated = bodyBuffer.length > MAX_BODY_SIZE;
        const bodyToSave = truncated ? bodyBuffer.subarray(0, MAX_BODY_SIZE) : bodyBuffer;

        const bodyFileName = `${name}.body`;
        const bodyPath = path.join(snapshotsDir, bodyFileName);
        await fs.writeFile(bodyPath, bodyToSave);

        snapshot.response.bodyFile = bodyFileName;
        snapshot.response.truncated = truncated;
        snapshot.response.size = bodyBuffer.length;

        // Remove buffer from JSON (keep only metadata)
        delete snapshot.response.body;
      }
    }
  }

  // Write run.json
  const runJsonPath = path.join(runDir, "run.json");
  await fs.writeFile(runJsonPath, JSON.stringify(runResult, null, 2), "utf8");
}

/**
 * Baca run.json
 * @param {string} cacheDir
 * @param {string} runId
 * @returns {Promise<RunResult|null>}
 */
export async function loadRun(cacheDir, runId) {
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
 * Add step to run result (called from event handler)
 * @param {RunResult} runResult
 * @param {Object} stepData - Parsed from SSE "step" event
 * @param {number} seq
 * @param {number} iteration
 */
export function addStep(runResult, stepData, seq, iteration) {
  const step = {
    seq,
    iteration,
    type: stepData.type,
    name: stepData.name,
    snapshot: stepData.snapshot || null, // <-- SNAPSHOT REFERENCE
    file: stepData.file || "",
    line: stepData.line || 0,
    transaction: stepData.transaction || null,
    request: stepData.request || { method: "", url: "", headers: {}, bodyPreview: "" },
    response: stepData.response || { status: 0, statusText: "", headers: {}, contentType: "", size: 0, bodyFile: "", truncated: false },
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
  });
}

/**
 * Update params in run result
 * @param {RunResult} runResult
 * @param {Record<string, string>} params
 */
export function updateParams(runResult, params) {
  runResult.params = { ...runResult.params, ...params };
}

/**
 * Add snapshot to run result (metadata only, body stored separately)
 * @param {RunResult} runResult
 * @param {Object} snapshotData
 * @param {string} cacheDir - optional, for saving body immediately
 * @param {string} runId - optional, for saving body immediately
 */
export function addSnapshot(runResult, snapshotData, cacheDir, runId) {
  if (!runResult.snapshots) runResult.snapshots = {};
  
  // Extract body to store separately
  const { response, ...meta } = snapshotData;
  const { body, ...responseMeta } = response || {};
  
  runResult.snapshots[snapshotData.name] = {
    ...meta,
    response: responseMeta,
  };
  
  // Save body to separate file if provided
  if (body && cacheDir && runId) {
    saveSnapshotBody(cacheDir, runId, snapshotData.name, body);
  }
}

/**
 * Save snapshot body to separate file
 * @param {string} cacheDir
 * @param {string} runId
 * @param {string} snapshotName
 * @param {Buffer|string} body
 * @param {Object} runResult - optional, to update metadata
 */
export async function saveSnapshotBody(cacheDir, runId, snapshotName, body, runResult) {
  const runDir = path.join(cacheDir, "runs", runId);
  const snapshotsDir = path.join(runDir, "snapshots");
  await fs.mkdir(snapshotsDir, { recursive: true });
  
  const bodyBuffer = body instanceof Buffer ? body : Buffer.from(body);
  const truncated = bodyBuffer.length > MAX_BODY_SIZE;
  const bodyToSave = truncated ? bodyBuffer.subarray(0, MAX_BODY_SIZE) : bodyBuffer;
  
  const bodyFileName = `${snapshotName}.body`;
  const bodyPath = path.join(snapshotsDir, bodyFileName);
  await fs.writeFile(bodyPath, bodyToSave);
  
  // Update snapshot metadata to reference body file (if runResult provided)
  if (runResult && runResult.snapshots && runResult.snapshots[snapshotName]) {
    runResult.snapshots[snapshotName].response.bodyFile = bodyFileName;
    runResult.snapshots[snapshotName].response.truncated = truncated;
    runResult.snapshots[snapshotName].response.size = bodyBuffer.length;
  }
}

/**
 * Load snapshot body
 * @param {string} cacheDir
 * @param {string} runId
 * @param {string} snapshotName
 * @returns {Promise<Buffer|null>}
 */
export async function loadSnapshotBody(cacheDir, runId, snapshotName) {
  const bodyPath = path.join(cacheDir, "runs", runId, "snapshots", `${snapshotName}.body`);
  try {
    return await fs.readFile(bodyPath);
  } catch {
    return null;
  }
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
  updateParams,
  finalizeRun,
  decodeBody,
};