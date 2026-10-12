/**
 * `GET /api/file` (read-only) dan `PUT /api/file` (Save atomic + backup).
 *
 * @typedef {import("../http-utils.js").IncomingMessage} IncomingMessage
 * @typedef {import("../http-utils.js").ServerResponse} ServerResponse
 */

import { readJsonBody, sendJson } from "../http-utils.js";
import { resolveScriptDir } from "../project/paths.js";
import { readScriptFile, saveScriptFile } from "../project/save.js";

/**
 * @param {IncomingMessage} _req
 * @param {ServerResponse} res
 * @param {URL} url
 */
export async function getFile(_req, res, url) {
  const scriptDir = await resolveScriptDir(url.searchParams.get("path"));
  sendJson(res, 200, await readScriptFile(scriptDir, url.searchParams.get("file")));
}

/**
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
export async function putFile(req, res) {
  const body = await readJsonBody(req);
  const scriptDir = await resolveScriptDir(body?.path);
  sendJson(res, 200, await saveScriptFile(scriptDir, body?.file, body?.text));
}
