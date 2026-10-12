/**
 * Baca & simpan satu file script (`.c`/`.h`).
 *
 * Aturan plan §4.3: Save wajib atomic (temp → rename), pertahankan line ending
 * (CRLF/LF) dan encoding asli, dan simpan backup ke cache sebelum menimpa.
 *
 * Catatan: file temp dibuat di folder yang sama dengan target karena
 * `fs.rename` hanya atomic dalam satu volume (di Windows, rename lintas drive
 * gagal dengan EXDEV). File temp selalu dihapus, termasuk saat gagal.
 * Rename diulang singkat bila gagal dengan EPERM/EACCES/EBUSY (lock sementara
 * dari antivirus/indexer di Windows).
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { HttpError, cacheDirFor, resolveScriptFile } from "./paths.js";

const SAVEABLE_EXTENSIONS = new Set([".c", ".h"]);

/** Deteksi encoding dari BOM. Hanya UTF-8 dan UTF-16LE yang bisa disimpan balik. */
function detectEncoding(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return "utf8-bom";
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return "utf16le";
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return "utf16be";
  return "utf8";
}

function decodeText(buffer, encoding) {
  switch (encoding) {
    case "utf8-bom":
      return buffer.subarray(3).toString("utf8");
    case "utf16le":
      return buffer.subarray(2).toString("utf16le");
    case "utf16be": {
      const swapped = Buffer.from(buffer.subarray(2));
      swapped.swap16();
      return swapped.toString("utf16le");
    }
    default:
      return buffer.toString("utf8");
  }
}

function encodeText(text, encoding, eol) {
  const normalized = text.replace(/\r\n|\r/g, "\n");
  const withEol = eol === "crlf" ? normalized.replace(/\n/g, "\r\n") : normalized;

  if (encoding === "utf8-bom") {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(withEol, "utf8")]);
  }
  if (encoding === "utf16le") {
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(withEol, "utf16le")]);
  }
  return Buffer.from(withEol, "utf8");
}

function detectEol(text) {
  return text.includes("\r\n") ? "crlf" : "lf";
}

/** Error rename yang di Windows sering hanya sementara (antivirus/indexer memegang handle). */
const TRANSIENT_RENAME_ERRORS = new Set(["EPERM", "EACCES", "EBUSY"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rename dengan retry singkat supaya Save tidak gagal karena lock sesaat. */
async function renameWithRetry(source, target, attempts = 5) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.rename(source, target);
      return;
    } catch (error) {
      if (!TRANSIENT_RENAME_ERRORS.has(error?.code) || attempt >= attempts) throw error;
      await sleep(20 * attempt);
    }
  }
}

/** Tulis buffer lewat file temp di folder yang sama, lalu rename. */
async function atomicWrite(target, buffer) {
  const dir = path.dirname(target);
  const temp = path.join(
    dir,
    `.${path.basename(target)}.vugenweb-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  try {
    await fs.writeFile(temp, buffer);
    await renameWithRetry(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeBackup(scriptDir, relative, buffer) {
  const dir = path.join(cacheDirFor(scriptDir), "backups");
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const flat = relative.replace(/[\\/]/g, "__");
  const target = path.join(dir, `${stamp}__${flat}`);
  await fs.writeFile(target, buffer);
  return target;
}

/**
 * Baca file script sebagai teks LF + metadata encoding/EOL asli.
 *
 * @param {string} scriptDir
 * @param {string} relativePath
 */
export async function readScriptFile(scriptDir, relativePath) {
  const { absolute, relative, stats } = await resolveScriptFile(scriptDir, relativePath);
  const buffer = await fs.readFile(absolute);

  if (buffer.includes(0)) {
    throw new HttpError(415, `File biner belum didukung: ${relative}`);
  }

  const encoding = detectEncoding(buffer);
  const raw = decodeText(buffer, encoding);

  return {
    path: relative,
    text: raw.replace(/\r\n|\r/g, "\n"),
    eol: detectEol(raw),
    encoding,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
}

/**
 * Simpan file script. Hanya `.c`/`.h` (plan §4.1). Encoding dan EOL diambil
 * dari file asli di server, bukan dari klien.
 *
 * @param {string} scriptDir
 * @param {string} relativePath
 * @param {unknown} nextText
 */
export async function saveScriptFile(scriptDir, relativePath, nextText) {
  if (typeof nextText !== "string") {
    throw new HttpError(400, "Field text wajib berupa string.");
  }

  const extension = path.extname(String(relativePath ?? "")).toLowerCase();
  if (!SAVEABLE_EXTENSIONS.has(extension)) {
    throw new HttpError(400, `Hanya file .c/.h yang bisa disimpan (diterima: ${extension || "tanpa ekstensi"}).`);
  }

  const { absolute, relative } = await resolveScriptFile(scriptDir, relativePath);
  const original = await fs.readFile(absolute);
  const encoding = detectEncoding(original);

  if (encoding === "utf16be") {
    throw new HttpError(400, `Encoding UTF-16 BE belum didukung untuk Save: ${relative}`);
  }

  const eol = detectEol(decodeText(original, encoding));
  const backup = await writeBackup(scriptDir, relative, original);

  await atomicWrite(absolute, encodeText(nextText, encoding, eol));

  const stats = await fs.stat(absolute);
  return { path: relative, size: stats.size, mtimeMs: stats.mtimeMs, encoding, eol, backup };
}
