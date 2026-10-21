/**
 * `PUT /api/parameter` — ubah Select next row / Update value on / When out of values sebuah parameter di `.prm`.
 *
 * @typedef {import("../http-utils.js").IncomingMessage} IncomingMessage
 * @typedef {import("../http-utils.js").ServerResponse} ServerResponse
 */

import { readJsonBody, sendJson } from "../http-utils.js";
import { resolveScriptDir } from "../project/paths.js";
import { updateParameterSetting } from "../project/prmWrite.js";

/**
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
export async function putParameter(req, res) {
  const body = await readJsonBody(req);
  const scriptDir = await resolveScriptDir(body?.path);
  sendJson(res, 200, await updateParameterSetting(scriptDir, body?.name, body?.changes));
}
