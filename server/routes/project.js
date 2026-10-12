/**
 * `GET /api/project` — validasi folder script, kembalikan daftar file + Run Logic.
 *
 * @typedef {import("../http-utils.js").IncomingMessage} IncomingMessage
 * @typedef {import("../http-utils.js").ServerResponse} ServerResponse
 */

import { sendJson } from "../http-utils.js";
import { loadProject } from "../project/loader.js";
import { resolveScriptDir } from "../project/paths.js";

/**
 * @param {IncomingMessage} _req
 * @param {ServerResponse} res
 * @param {URL} url
 */
export async function getProject(_req, res, url) {
  const scriptDir = await resolveScriptDir(url.searchParams.get("path"));
  sendJson(res, 200, await loadProject(scriptDir));
}
