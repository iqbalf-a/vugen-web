/**
 * Dispatch route /api tanpa Express (gaya Connect: `handler(req, res, url)`).
 *
 * Karena Vite/Connect sudah membuang prefix `/api`, sekaligus supaya router bisa
 * dites langsung tanpa Vite, path dinormalisasi: `/api/file` maupun `/file`
 * sama-sama cocok.
 *
 * @typedef {import("../http-utils.js").IncomingMessage} IncomingMessage
 * @typedef {import("../http-utils.js").ServerResponse} ServerResponse
 * @typedef {{ methods: string[], path: string, handler: (req: IncomingMessage, res: ServerResponse, url: URL) => unknown }} ApiRoute
 */

import { requestUrl, sendError, sendJson } from "../http-utils.js";
import { getFile, putFile } from "./file.js";
import { getProject } from "./project.js";

/** @type {ApiRoute[]} */
const routes = [
  {
    methods: ["GET"],
    path: "/health",
    handler(_req, res) {
      sendJson(res, 200, { ok: true });
    },
  },
  { methods: ["GET"], path: "/project", handler: getProject },
  { methods: ["GET"], path: "/file", handler: getFile },
  { methods: ["PUT"], path: "/file", handler: putFile },
];

function normalizePath(pathname) {
  if (pathname === "/api") return "/";
  if (pathname.startsWith("/api/")) return pathname.slice("/api".length);
  return pathname;
}

function statusOf(error) {
  const status = /** @type {{ status?: unknown }} */ (error)?.status;
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

export function apiRouter(req, res) {
  const url = requestUrl(req);
  const pathname = normalizePath(url.pathname);
  const method = req.method ?? "GET";

  const forPath = routes.filter((route) => route.path === pathname);
  if (forPath.length === 0) {
    sendError(res, 404, `Route tidak ditemukan: ${method} ${pathname}.`);
    return;
  }

  const route = forPath.find((candidate) => candidate.methods.includes(method));
  if (!route) {
    sendError(res, 405, `Method ${method} tidak didukung untuk ${pathname}.`);
    return;
  }

  Promise.resolve()
    .then(() => route.handler(req, res, url))
    .catch((error) => {
      const status = statusOf(error);
      if (status >= 500) console.error(`[api] ${method} ${pathname} gagal:`, error);
      if (res.headersSent) {
        res.end();
        return;
      }
      sendError(res, status, error instanceof Error ? error.message : String(error));
    });
}
