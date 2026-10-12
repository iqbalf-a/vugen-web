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
      throw new Error(`Respons bukan JSON (HTTP ${res.status}).`);
    }
  }

  if (!res.ok) {
    throw new Error(data?.error ?? `Request gagal (HTTP ${res.status}).`);
  }
  return data;
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
