import { promises as fs } from "node:fs";
import path from "node:path";
import { sendError, sendJson } from "../http-utils.js";

function libraryRoot() {
  return process.env.VUGEN_SCRIPT_LIBRARY ?? "";
}

/** Cek apakah folder berisi setidaknya satu .c file (= script VuGen) */
async function isScriptDir(dirPath) {
  try {
    const entries = await fs.readdir(dirPath);
    return entries.some((f) => f.endsWith(".c"));
  } catch {
    return false;
  }
}

/** GET /api/library — daftar channel (subfolder di root library) */
export async function getLibraryChannels(_req, res) {
  const root = libraryRoot();
  if (!root) {
    sendError(res, 503, "VUGEN_SCRIPT_LIBRARY is not configured in .env");
    return;
  }
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const channels = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    sendJson(res, 200, { channels });
  } catch (err) {
    sendError(res, 500, `Failed to read library: ${err.message}`);
  }
}

/** GET /api/library?channel=MCM — daftar script BP dalam channel */
export async function getLibraryScripts(req, res, url) {
  const root = libraryRoot();
  if (!root) {
    sendError(res, 503, "VUGEN_SCRIPT_LIBRARY is not configured in .env");
    return;
  }
  const channel = url.searchParams.get("channel");
  if (!channel) {
    sendError(res, 400, "Parameter 'channel' is required");
    return;
  }
  const channelPath = path.join(root, channel);
  try {
    const entries = await fs.readdir(channelPath, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory() && e.name.toLowerCase() !== "backup");
    const checked = await Promise.all(
      dirs.map(async (e) => {
        const full = path.join(channelPath, e.name);
        const valid = await isScriptDir(full);
        return valid ? { name: e.name, path: full } : null;
      }),
    );
    const scripts = checked.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    sendJson(res, 200, { channel, scripts });
  } catch (err) {
    sendError(res, 500, `Failed to read channel "${channel}": ${err.message}`);
  }
}
