/**
 * project/parameters.js — Baca file parameter `.dat` script VuGen.
 *
 * Format `.dat`: baris pertama SELALU header (nama kolom dipisah koma), baris berikutnya nilai.
 * Setiap kolom header menjadi satu parameter (nama case-sensitive, di-trim), sehingga
 * `{ip}` / `{subTrans}` langsung tersedia tanpa `lr_save_string`.
 *
 * File `.prm` (konfigurasi parameter VuGen, format INI) sengaja TIDAK dibaca di sini;
 * mesin `.prm` lengkap ada di backlog (plan-stabilisasi.md §9).
 *
 * @typedef {Object} ParameterDef
 * @property {string} name - nama parameter (dari header)
 * @property {string} file - path relatif file `.dat` (POSIX)
 * @property {number} rows - jumlah baris nilai
 * @property {string[]} values - nilai per baris (hanya untuk runner; tidak dikirim ke browser)
 */

import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Parse isi satu file `.dat`.
 *
 * @param {string} text
 * @returns {{ name: string, values: string[] }[]} satu entri per kolom header
 */
export function parseDat(text) {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = withoutBom.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];

  const headers = lines[0].split(",").map((header) => header.trim());
  const columns = headers.map((name) => ({ name, values: /** @type {string[]} */ ([]) }));

  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    columns.forEach((column, index) => column.values.push(cells[index] ?? ""));
  }

  return columns.filter((column) => column.name !== "");
}

/**
 * Baca semua `.dat` di root script dan `data/`.
 * Nama parameter yang sama di dua file: file pertama dipakai, sisanya diberi warning.
 *
 * @param {string} scriptDir
 * @param {Array<{ path: string, ext: string }>} files
 * @returns {Promise<{ parameters: ParameterDef[], warnings: string[] }>}
 */
export async function loadParameters(scriptDir, files) {
  /** @type {ParameterDef[]} */
  const parameters = [];
  /** @type {string[]} */
  const warnings = [];
  const seen = new Map();

  // File di root dibaca lebih dulu daripada data/ (root menang bila nama parameter sama)
  const datFiles = files
    .filter((file) => file.ext === ".dat" && (file.path.startsWith("data/") || !file.path.includes("/")))
    .sort((a, b) => Number(a.path.includes("/")) - Number(b.path.includes("/")));
  for (const datFile of datFiles) {
    let text;
    try {
      text = await fs.readFile(path.join(scriptDir, ...datFile.path.split("/")), "utf8");
    } catch (error) {
      warnings.push(`Gagal membaca file parameter ${datFile.path}: ${error.message}`);
      continue;
    }

    for (const column of parseDat(text)) {
      if (seen.has(column.name)) {
        warnings.push(`Parameter "${column.name}" di ${datFile.path} diabaikan; sudah dibaca dari ${seen.get(column.name)}.`);
        continue;
      }
      seen.set(column.name, datFile.path);
      parameters.push({ name: column.name, file: datFile.path, rows: column.values.length, values: column.values });
    }
  }

  return { parameters, warnings };
}
