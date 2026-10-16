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
import { handleRunRoutes } from "./run.js";

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
  { methods: ["POST"], path: "/run", handler: handleRunRoutes },
  { methods: ["GET"], path: "/run/:id/events", handler: handleRunRoutes },
  { methods: ["POST"], path: "/run/:id/stop", handler: handleRunRoutes },
  { methods: ["GET"], path: "/run/:id", handler: handleRunRoutes },
  { methods: ["GET"], path: "/run/:id/step/:seq/body", handler: handleRunRoutes },
  { methods: ["GET"], path: "/run/:id/snapshot/:name/body", handler: handleRunRoutes },
  { methods: ["GET"], path: "/run/:id/debug", handler: handleRunRoutes },
];

function normalizePath(pathname) {
  if (pathname === "/api") return "/";
  if (pathname.startsWith("/api/")) return pathname.slice("/api".length);
  return pathname;
}

function matchRoute(pathname, routePath) {
  // Exact match
  if (pathname === routePath) return true;
  // Dynamic route match (e.g., /run/:id/events matches /run/abc/events)
  if (routePath.includes(":")) {
    const routeRegex = new RegExp("^" + routePath.replace(/:[^/]+/g, "[^/]+") + "$");
    return routeRegex.test(pathname);
  }
  return false;
}

function statusOf(error) {
  const status = /** @type {{ status?: unknown }} */ (error)?.status;
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

export function apiRouter(req, res) {
  const url = requestUrl(req);
  const pathname = normalizePath(url.pathname);
  const method = req.method ?? "GET";

  // Find matching route (exact or dynamic)
  const forPath = routes.filter((route) => matchRoute(pathname, route.path));
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
