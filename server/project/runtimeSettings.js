/**
 * project/runtimeSettings.js — Baca/tulis Runtime Settings VuGen di `default.cfg` (INI), section `[WEB]`:
 *
 *   ConnectTimeout       HTTP request connect timeout (detik)
 *   ReceiveTimeout       HTTP request receive timeout (detik)
 *   KeepAliveTimeout     HTTP Keep-Alive timeout (detik)
 *   PageDownloadTimeout  Step download timeout (detik)
 *   HttpErrorsAsWarnings 1 = "Mark HTTP errors as warnings"
 *
 * Penulisan hanya menyentuh baris yang berubah (urutan, komentar, EOL, encoding dibiarkan); file dibaca
 * sebagai latin1 supaya byte non-ASCII kembali persis sama. File lama dicadangkan ke cache sebelum ditimpa.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { HttpError } from "./paths.js";
import { atomicWrite, writeBackup } from "./save.js";

/** Default VuGen bila key tidak ada di file. */
export const RUNTIME_DEFAULTS = Object.freeze({
  connectTimeout: 120,
  receiveTimeout: 120,
  keepAliveTimeout: 60,
  pageDownloadTimeout: 120,
  httpErrorsAsWarnings: false,
});

/** Nama field → key di [WEB]. */
const KEYS = {
  connectTimeout: "ConnectTimeout",
  receiveTimeout: "ReceiveTimeout",
  keepAliveTimeout: "KeepAliveTimeout",
  pageDownloadTimeout: "PageDownloadTimeout",
  httpErrorsAsWarnings: "HttpErrorsAsWarnings",
};

const SECTION = "WEB";
const BOM = "ï»¿";
export const MAX_TIMEOUT_SECONDS = 86400;

/** Ambil nilai key (case-insensitive) di section; nilai terakhir menang. */
function readKey(text, section, key) {
  let inSection = false;
  let found = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(BOM, "").trim();
    const header = line.match(/^\[(.+)\]$/);
    if (header) {
      inSection = header[1].trim().toLowerCase() === section.toLowerCase();
      continue;
    }
    if (!inSection || line.startsWith(";") || line.startsWith("#")) continue;
    const m = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (m && m[1].trim().toLowerCase() === key.toLowerCase()) found = m[2].trim().replace(/^"|"$/g, "");
  }
  return found;
}

/**
 * @param {string} text isi default.cfg
 * @returns {typeof RUNTIME_DEFAULTS}
 */
export function parseRuntimeSettings(text) {
  const result = { ...RUNTIME_DEFAULTS };
  for (const field of ["connectTimeout", "receiveTimeout", "keepAliveTimeout", "pageDownloadTimeout"]) {
    const value = Number(readKey(text, SECTION, KEYS[field]));
    if (Number.isFinite(value) && value > 0) result[field] = Math.min(Math.trunc(value), MAX_TIMEOUT_SECONDS);
  }
  const flag = readKey(text, SECTION, KEYS.httpErrorsAsWarnings);
  if (flag !== null) result.httpErrorsAsWarnings = flag === "1" || flag.toLowerCase() === "true";
  return result;
}

/**
 * Set key di satu section INI tanpa mengubah baris lain. Key/section yang belum ada ditambahkan.
 *
 * @param {string} text
 * @param {string} section
 * @param {Record<string, string>} entries key → nilai
 */
export function setIniKeys(text, section, entries) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.split(/\r?\n/);
  const isHeader = (line) => /^\s*\[.+\]\s*$/.test(line.replace(BOM, ""));

  let start = lines.findIndex((line) => {
    const m = line.replace(BOM, "").trim().match(/^\[(.+)\]$/);
    return m !== null && m[1].trim().toLowerCase() === section.toLowerCase();
  });
  if (start === -1) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    if (lines.length > 0) lines.push("");
    start = lines.length;
    lines.push(`[${section}]`);
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (isHeader(lines[i])) {
      end = i;
      break;
    }
  }

  const missing = [];
  for (const [key, value] of Object.entries(entries)) {
    let replaced = false;
    for (let i = start + 1; i < end; i += 1) {
      const m = lines[i].match(/^(\s*)([^=;#\s][^=]*?)(\s*=\s*)/);
      if (m && m[2].trim().toLowerCase() === key.toLowerCase()) {
        lines[i] = `${m[1]}${m[2]}${m[3]}${value}`;
        replaced = true;
      }
    }
    if (!replaced) missing.push(`${key}=${value}`);
  }
  if (missing.length > 0) {
    let insertAt = end;
    while (insertAt > start + 1 && lines[insertAt - 1].trim() === "") insertAt -= 1;
    lines.splice(insertAt, 0, ...missing);
  }

  const out = lines.join(eol);
  // split() pada teks ber-EOL akhir sudah menyisakan elemen "" penutup; hanya file kosong / section baru di akhir perlu EOL
  return text === "" || lines[lines.length - 1] !== "" ? `${out}${eol}` : out;
}

/** Cari `default.cfg` di root folder script (nama case-insensitive). @returns {Promise<string|null>} nama file asli */
async function findCfg(scriptDir) {
  const entries = await fs.readdir(scriptDir);
  return entries.find((name) => name.toLowerCase() === "default.cfg") ?? null;
}

/**
 * @param {string} scriptDir
 * @returns {Promise<typeof RUNTIME_DEFAULTS & { file: string|null }>} `file` null = belum ada default.cfg (nilai default)
 */
export async function readRuntimeSettings(scriptDir) {
  const name = await findCfg(scriptDir);
  if (!name) return { ...RUNTIME_DEFAULTS, file: null };
  const text = (await fs.readFile(path.join(scriptDir, name))).toString("latin1");
  return { ...parseRuntimeSettings(text), file: name };
}

/**
 * Validasi + tulis perubahan ke default.cfg (dibuat bila belum ada).
 *
 * @param {string} scriptDir
 * @param {Record<string, unknown>} changes subset dari field RUNTIME_DEFAULTS
 */
export async function updateRuntimeSettings(scriptDir, changes) {
  if (changes === null || typeof changes !== "object") throw new HttpError(400, "changes is required.");
  /** @type {Record<string, string>} */
  const entries = {};
  for (const [field, value] of Object.entries(changes)) {
    if (!(field in KEYS)) throw new HttpError(400, `Unknown runtime setting: ${field}`);
    if (field === "httpErrorsAsWarnings") {
      if (typeof value !== "boolean") throw new HttpError(400, "httpErrorsAsWarnings must be true or false.");
      entries[KEYS[field]] = value ? "1" : "0";
    } else {
      const seconds = Number(value);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_TIMEOUT_SECONDS) {
        throw new HttpError(400, `${KEYS[field]} must be a whole number of seconds between 1 and ${MAX_TIMEOUT_SECONDS}.`);
      }
      entries[KEYS[field]] = String(seconds);
    }
  }
  if (Object.keys(entries).length === 0) throw new HttpError(400, "No changes.");

  const existing = await findCfg(scriptDir);
  const name = existing ?? "default.cfg";
  const absolute = path.join(scriptDir, name);
  const original = existing ? await fs.readFile(absolute) : null;
  if (original && ((original[0] === 0xff && original[1] === 0xfe) || (original[0] === 0xfe && original[1] === 0xff))) {
    throw new HttpError(400, `UTF-16 config files can't be edited: ${name}`);
  }

  const next = Buffer.from(setIniKeys(original ? original.toString("latin1") : "", SECTION, entries), "latin1");
  if (!original || !next.equals(original)) {
    if (original) await writeBackup(scriptDir, name, original);
    await atomicWrite(absolute, next);
  }
  return readRuntimeSettings(scriptDir);
}
