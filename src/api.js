/**
 * Klien tipis untuk API di bawah /api.
 *
 * @param {string} path
 * @param {RequestInit} [init]
 */
export async function requestJson(path, init = {}) {
  const res = await fetch(path, {
    ...init,
    headers: { Accept: "application/json", ...(init.headers ?? {}) },
  });

  const text = await res.text();
  /** @type {any} */
  let data = null;
  if (text !== "") {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Response is not JSON (HTTP ${res.status}).`);
    }
  }

  if (!res.ok) {
    throw new Error(data?.error ?? `Request failed (HTTP ${res.status}).`);
  }
  return data;
}

/** Raw fetch untuk body biner */
export async function requestRaw(path, init = {}) {
  const res = await fetch(path, {
    ...init,
    headers: { ...(init.headers ?? {}) },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed (HTTP ${res.status}).`);
  }
  return res.arrayBuffer();
}

export function getHealth() {
  return requestJson("/api/health");
}

/**
 * @param {string} scriptPath
 */
export function openProject(scriptPath) {
  return requestJson(`/api/project?path=${encodeURIComponent(scriptPath)}`);
}

/**
 * @param {string} scriptPath
 * @param {string} file
 */
export function readFile(scriptPath, file) {
  return requestJson(`/api/file?path=${encodeURIComponent(scriptPath)}&file=${encodeURIComponent(file)}`);
}

/**
 * @param {{ path: string, file: string, text: string }} payload
 */
export function saveFile({ path, file, text }) {
  return requestJson("/api/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, file, text }),
  });
}

/**
 * @param {{ path: string, name: string, changes: Record<string, string> }} payload
 */
export function saveParameterSetting({ path, name, changes }) {
  return requestJson("/api/parameter", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, name, changes }),
  });
}

/**
 * @param {{ path: string, name: string, type: string, [key: string]: unknown }} payload
 */
export function addParameter(payload) {
  return requestJson("/api/parameter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * @param {string} scriptPath
 * @param {Object} options
 */
export function startRun(scriptPath, options) {
  return requestJson("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: scriptPath, options }),
  });
}

/**
 * @param {string} runId
 */
export function stopRun(runId) {
  return requestJson(`/api/run/${runId}/stop`, { method: "POST" });
}

export function resumeRun(runId) {
  return requestJson(`/api/run/${encodeURIComponent(runId)}/resume`, { method: "POST" });
}

/**
 * @param {string} runId
 * @param {string} scriptPath
 */
export function getRun(runId, scriptPath) {
  return requestJson(`/api/run/${runId}?path=${encodeURIComponent(scriptPath)}`);
}

/**
 * @param {string} runId
 * @param {string} scriptPath
 * @param {(event: {type: string, data: any, ts: number}) => void} onEvent
 * @returns {Promise<EventSource>}
 */
export function getRunEvents(runId, scriptPath, onEvent) {
  return new Promise((resolve, reject) => {
    const url = `/api/run/${runId}/events?path=${encodeURIComponent(scriptPath)}`;
    const es = new EventSource(url);

    es.onopen = () => resolve(es);
    es.onerror = (err) => {
      if (es.readyState === EventSource.CLOSED) return;
      reject(err);
    };

    ["step", "stepPending", "lineAt", "log", "transaction", "iterationStart", "iterationEnd", "started", "done", "stopped", "error", "paused"].forEach(type => {
      es.addEventListener(type, (e) => {
        try {
          onEvent({ type, data: e.data ? JSON.parse(e.data) : {}, ts: Date.now() });
        } catch {
          // ignore parse errors
        }
      });
    });
  });
}

export function getSession() {
  return requestJson("/api/session");
}

/** @param {string} profile */
export function login(profile) {
  return requestJson("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile }),
  });
}

export function logout() {
  return requestJson("/api/session", { method: "DELETE" });
}

export function fetchProfileList() {
  return requestJson("/api/profiles");
}

/** @param {string} name */
export function addProfile(name) {
  return requestJson("/api/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

/** @param {string} name */
export function removeProfile(name) {
  return requestJson(`/api/profiles/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export function fetchLibraryChannels() {
  return requestJson("/api/library");
}

/** @param {string} channel */
export function fetchLibraryScripts(channel) {
  return requestJson(`/api/library?channel=${encodeURIComponent(channel)}`);
}

/**
 * GET request with query params, returns arrayBuffer
 * @param {string} path
 * @param {{ params?: Record<string, string> }} options
 */
export async function apiGet(path, { params } = {}) {
  const url = new URL(path, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
  }
  const res = await fetch(url, { headers: { Accept: "application/octet-stream" } });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.arrayBuffer();
}
