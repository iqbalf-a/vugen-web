/**
 * `PUT /api/runtime-settings` — simpan timeout & "Mark HTTP errors as warnings" ke default.cfg.
 *
 * @typedef {import("../http-utils.js").IncomingMessage} IncomingMessage
 * @typedef {import("../http-utils.js").ServerResponse} ServerResponse
 */

import { readJsonBody, sendJson } from "../http-utils.js";
import { resolveScriptDir } from "../project/paths.js";
import { updateRuntimeSettings } from "../project/runtimeSettings.js";

/**
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
export async function putRuntimeSettings(req, res) {
  const body = await readJsonBody(req);
  const scriptDir = await resolveScriptDir(body?.path);
  sendJson(res, 200, await updateRuntimeSettings(scriptDir, body?.changes));
}
