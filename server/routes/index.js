/**
 * Dispatch route /api tanpa Express (gaya Connect: `handler(req, res)`).
 *
 * Karena Vite/Connect sudah membuang prefix `/api`, sekaligus untuk membuat
 * router bisa dites langsung tanpa Vite, path dinormalisasi: `/api/health`
 * maupun `/health` sama-sama cocok.
 *
 * @typedef {import("../http-utils.js").IncomingMessage} IncomingMessage
 * @typedef {import("../http-utils.js").ServerResponse} ServerResponse
 * @typedef {{ methods: string[], path: string, handler: (req: IncomingMessage, res: ServerResponse, url: URL) => unknown }} ApiRoute
 */

import { requestUrl, sendError, sendJson } from "../http-utils.js";

/** @type {ApiRoute[]} */
const routes = [
  {
    methods: ["GET"],
    path: "/health",
    handler(_req, res) {
      sendJson(res, 200, { ok: true });
    },
  },
];

function normalizePath(pathname) {
  if (pathname === "/api") return "/";
  if (pathname.startsWith("/api/")) return pathname.slice("/api".length);
  return pathname;
}

export function apiRouter(req, res) {
  const url = requestUrl(req);
  const pathname = normalizePath(url.pathname);

  for (const route of routes) {
    if (route.path !== pathname) continue;
    if (!route.methods.includes(req.method ?? "GET")) {
      sendError(res, 405, `Method ${req.method} tidak didukung untuk ${pathname}.`);
      return;
    }
    Promise.resolve()
      .then(() => route.handler(req, res, url))
      .catch((error) => {
        if (res.headersSent) {
          res.end();
          return;
        }
        sendError(res, 500, error instanceof Error ? error.message : String(error));
      });
    return;
  }

  sendError(res, 404, `Route tidak ditemukan: ${req.method ?? "GET"} ${pathname}.`);
}
