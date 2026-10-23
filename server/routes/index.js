/**
 * Dispatch route /api tanpa Express (gaya Connect: `handler(req, res, url)`).
 *
 * Karena Vite/Connect sudah membuang prefix `/api`, sekaligus supaya router bisa
 * dites langsung tanpa Vite, path dinormalisasi: `/api/file` maupun `/file`
 * sama-sama cocok.
 *
 * @typedef {import("../http-utils.js").IncomingMessage} IncomingMessage
 * @typedef {import("../http-utils.js").ServerResponse} ServerResponse
 * @typedef {Record<string, string>} RouteParams - hasil match `:nama` di path
 * @typedef {{ methods: string[], path: string, handler: (req: IncomingMessage, res: ServerResponse, url: URL, params: RouteParams) => unknown }} ApiRoute
 */

import { requestUrl, sendError, sendJson } from "../http-utils.js";
import { getFile, putFile } from "./file.js";
import { getLibraryChannels, getLibraryScripts } from "./library.js";
import { putParameter } from "./parameter.js";
import { getProject } from "./project.js";
import { handleRunEvents, handleRunGet, handleRunPost, handleRunResume, handleRunStepBody, handleRunStop } from "./run.js";

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
  {
    methods: ["GET"],
    path: "/library",
    handler(req, res, url) {
      return url.searchParams.has("channel") ? getLibraryScripts(req, res, url) : getLibraryChannels(req, res, url);
    },
  },
  { methods: ["GET"], path: "/file", handler: getFile },
  { methods: ["PUT"], path: "/file", handler: putFile },
  { methods: ["PUT"], path: "/parameter", handler: putParameter },
  { methods: ["POST"], path: "/run", handler: handleRunPost },
  { methods: ["GET"], path: "/run/:id/events", handler: handleRunEvents },
  { methods: ["POST"], path: "/run/:id/stop", handler: handleRunStop },
  { methods: ["POST"], path: "/run/:id/resume", handler: handleRunResume },
  { methods: ["GET"], path: "/run/:id", handler: handleRunGet },
  { methods: ["GET"], path: "/run/:id/step/:seq/body", handler: handleRunStepBody },
];

function normalizePath(pathname) {
  if (pathname === "/api") return "/";
  if (pathname.startsWith("/api/")) return pathname.slice("/api".length);
  return pathname;
}

/**
 * Cocokkan pathname dengan pola route (`:nama` = satu segmen).
 *
 * @param {string} pathname
 * @param {string} routePath
 * @returns {RouteParams|null} params bila cocok, null bila tidak
 */
function matchRoute(pathname, routePath) {
  const names = [];
  const pattern = routePath.replace(/:([A-Za-z]+)/g, (_, name) => {
    names.push(name);
    return "([^/]+)";
  });
  const match = new RegExp(`^${pattern}$`).exec(pathname);
  if (!match) return null;

  /** @type {RouteParams} */
  const params = {};
  names.forEach((name, index) => {
    try {
      params[name] = decodeURIComponent(match[index + 1]);
    } catch {
      params[name] = match[index + 1];
    }
  });
  return params;
}

function statusOf(error) {
  const status = /** @type {{ status?: unknown }} */ (error)?.status;
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

export function apiRouter(req, res) {
  const url = requestUrl(req);
  const pathname = normalizePath(url.pathname);
  const method = req.method ?? "GET";

  // Semua route yang cocok dengan path (method dicek setelahnya untuk 405)
  const forPath = routes
    .map((route) => ({ route, params: matchRoute(pathname, route.path) }))
    .filter((entry) => entry.params !== null);
  if (forPath.length === 0) {
    sendError(res, 404, `Route tidak ditemukan: ${method} ${pathname}.`);
    return;
  }

  const matched = forPath.find((entry) => entry.route.methods.includes(method));
  if (!matched) {
    sendError(res, 405, `Method ${method} tidak didukung untuk ${pathname}.`);
    return;
  }

  Promise.resolve()
    .then(() => matched.route.handler(req, res, url, matched.params))
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
