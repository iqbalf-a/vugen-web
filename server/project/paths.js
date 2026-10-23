/**
 * Keamanan path + lokasi cache.
 *
 * Aturan plan §4.1: folder script bersifat read-only kecuali aksi Save.
 * Aturan §4.2: semua artefak ditulis ke `.cache/<hash-path-script>/` di luar
 * folder script.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/** Error yang membawa status HTTP. */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   */
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** Root cache. Bisa dioverride lewat env untuk pengujian. */
export function cacheRoot() {
  const override = process.env.VUGEN_CACHE_DIR;
  return override ? path.resolve(override) : path.resolve(process.cwd(), ".cache");
}

/** Hash 16 hex dari path folder script (dinormalisasi, case-insensitive di Windows). */
export function cacheKeyFor(scriptDir) {
  const normalized = path.resolve(scriptDir).replace(/\\/g, "/").toLowerCase();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function cacheDirFor(scriptDir) {
  return path.join(cacheRoot(), cacheKeyFor(scriptDir));
}

/** Direktori run per-profile: `.cache/<hash>/profiles/<profile>` */
export function runCacheDirFor(scriptDir, profile = "_") {
  return path.join(cacheDirFor(scriptDir), "profiles", profile);
}

/** Ubah pemisah path Windows jadi `/` agar konsisten di API dan cache. */
export function toPosix(value) {
  return value.split(path.sep).join("/");
}

function isInside(parent, child) {
  return child === parent || child.startsWith(parent + path.sep);
}

/**
 * Validasi folder script. Kembalikan realpath-nya.
 *
 * @param {unknown} input
 * @returns {Promise<string>}
 */
export async function resolveScriptDir(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new HttpError(400, "Parameter 'path' is required.");
  }
  const absolute = path.resolve(input.trim());
  let stats;
  try {
    stats = await fs.stat(absolute);
  } catch {
    throw new HttpError(400, `Folder not found: ${absolute}`);
  }
  if (!stats.isDirectory()) throw new HttpError(400, `Not a folder: ${absolute}`);
  return fs.realpath(absolute);
}

/**
 * Resolve file relatif di dalam folder script.
 * Menolak path absolut, `..`, dan symlink yang keluar dari folder script.
 *
 * @param {string} scriptDir realpath folder script
 * @param {unknown} relativePath
 * @returns {Promise<{ absolute: string, relative: string, stats: import("node:fs").Stats }>}
 */
export async function resolveScriptFile(scriptDir, relativePath) {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new HttpError(400, "Parameter 'file' is required.");
  }
  const relative = relativePath.trim();
  if (path.isAbsolute(relative)) {
    throw new HttpError(400, "File path must be relative to the script folder.");
  }

  const candidate = path.resolve(scriptDir, relative);
  if (!isInside(scriptDir, candidate)) {
    throw new HttpError(400, "Access outside the script folder is not allowed.");
  }

  let real;
  try {
    real = await fs.realpath(candidate);
  } catch {
    throw new HttpError(404, `File not found: ${relative}`);
  }
  if (!isInside(scriptDir, real)) {
    throw new HttpError(400, "Access outside the script folder is not allowed (symlink).");
  }

  const stats = await fs.stat(real);
  if (!stats.isFile()) throw new HttpError(400, `Not a file: ${relative}`);

  return { absolute: real, relative: toPosix(path.relative(scriptDir, real)), stats };
}
