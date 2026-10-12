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
  if (text.trim() !== "") {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Respons dari ${path} bukan JSON (status ${res.status}).`);
    }
  }

  if (!res.ok) {
    throw new Error(data?.error ?? `Request gagal: ${res.status} ${res.statusText}`);
  }
  return data;
}

/** GET /api/health */
export function getHealth() {
  return requestJson("/api/health");
}
