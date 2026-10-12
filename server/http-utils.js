/**
 * Utilitas HTTP untuk middleware /api (tanpa Express).
 *
 * Catatan penting (plan §5, gotcha #1): Vite memakai Connect, sehingga
 * `server.middlewares.use("/api", router)` SUDAH membuang prefix `/api` dari
 * `req.url`. Jadi di dalam router `req.url` bernilai `/health`, bukan
 * `/api/health`. `req.originalUrl` menyimpan path aslinya.
 *
 * @typedef {import("node:http").IncomingMessage} IncomingMessage
 * @typedef {import("node:http").ServerResponse} ServerResponse
 */

const JSON_LIMIT_BYTES = 1_000_000;

/** Bangun URL dari req.url (relatif) dengan base dummy. */
export function requestUrl(req, base = "http://127.0.0.1") {
  return new URL(req.url ?? "/", base);
}

/** Kirim JSON dengan Content-Length eksplisit dan tanpa cache. */
export function sendJson(res, status, body) {
  const payload = JSON.stringify(body ?? null);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.setHeader("Cache-Control", "no-store");
  res.end(payload);
}

/** Kirim error dalam bentuk `{ error }` yang seragam. */
export function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

/**
 * Baca body JSON. Kembalikan `{}` untuk body kosong, lempar Error untuk body
 * rusak atau kelewat besar.
 *
 * @param {IncomingMessage} req
 */
export async function readJsonBody(req, { limit = JSON_LIMIT_BYTES } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Body terlalu besar.");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Body bukan JSON yang valid.");
  }
}

/**
 * Buka koneksi Server-Sent Events.
 *
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @returns {{ send: (event: string, data: unknown) => void, comment: (text?: string) => void, close: () => void, readonly closed: boolean }}
 */
export function startSse(req, res, { heartbeatMs = 15_000 } = {}) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "keep-alive");
  // Cegah buffering di proxy apa pun antara browser dan dev server.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let closed = false;
  const listeners = new Set();

  const heartbeat = setInterval(() => {
    if (!closed) res.write(": keep-alive\n\n");
  }, heartbeatMs);
  heartbeat.unref?.();

  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    listeners.clear();
  }

  req.on("close", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);

  return {
    send(event, data) {
      if (closed) return;
      listeners.forEach((listener) => listener(event, data));
      res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`);
    },
    comment(text = "") {
      if (!closed) res.write(`: ${text}\n\n`);
    },
    close() {
      cleanup();
      if (!res.writableEnded) res.end();
    },
    onClose(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get closed() {
      return closed;
    },
  };
}
