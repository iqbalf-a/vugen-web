/**
 * project/parameters.js — Baca file parameter `.dat` dan konfigurasi `.prm` script VuGen.
 *
 * Format `.dat`: baris pertama SELALU header (nama kolom dipisah koma), baris berikutnya nilai.
 * Format `.prm`: INI-style dengan seksi `[parameter:NAME]` dan key=value.
 *
 * @typedef {Object} ParameterDef
 * @property {string} name - nama parameter (dari header .dat)
 * @property {string} file - path relatif file `.dat` (POSIX)
 * @property {number} rows - jumlah baris nilai
 * @property {string[]} values - nilai per baris (hanya untuk runner; tidak dikirim ke browser)
 * @property {"Table"|"Time"|"Userid"} [type] - tipe dari .prm (default "Table")
 * @property {"Sequential"|"Random"|"Unique"|"Once"} [selectNextRow] - strategi pilih baris (default "Sequential")
 * @property {"EachIteration"|"EachOccurrence"|"Once"} [updateValueOn] - kapan nilai diperbarui (default "EachIteration")
 * @property {"Cycle"|"Continue"|"Abort"} [outOfRangePolicy] - jika indeks melebihi baris (default "Cycle")
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
 * Parse isi satu file `.prm` (format INI VuGen).
 * Menghasilkan satu entri per seksi `[parameter:NAME]`.
 *
 * @param {string} text
 * @returns {{ name: string, type: string, table: string|null, selectNextRow: string, updateValueOn: string, outOfRangePolicy: string }[]}
 */
export function parsePrm(text) {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = withoutBom.split(/\r?\n/);

  /** @type {{ name: string, type: string, table: string|null, selectNextRow: string, updateValueOn: string, outOfRangePolicy: string }[]} */
  const sections = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith(";")) continue;

    const secMatch = line.match(/^\[parameter:(.+)\]$/i);
    if (secMatch) {
      current = {
        name: secMatch[1].trim(),
        type: "Table",
        table: null,
        selectNextRow: "Sequential",
        updateValueOn: "EachIteration",
        outOfRangePolicy: "Cycle",
      };
      sections.push(current);
      continue;
    }

    if (!current) continue;

    const kvMatch = line.match(/^(\w+)\s*=\s*"?([^"]*)"?$/);
    if (!kvMatch) continue;
    const [, key, val] = kvMatch;

    switch (key.toLowerCase()) {
      case "type":
        current.type = val;
        break;
      case "table":
        current.table = val || null;
        break;
      case "selectnextrow":
        current.selectNextRow = val;
        break;
      case "updatevalueon":
        current.updateValueOn = val;
        break;
      case "whenoutofvalues":
      case "outofrangepolicy":
        current.outOfRangePolicy = val;
        break;
    }
  }

  return sections;
}

/**
 * Baca semua `.dat` di root script dan `data/`, lalu terapkan konfigurasi dari `.prm`.
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

  // Terapkan konfigurasi dari file .prm
  const prmFiles = files.filter((file) => file.ext === ".prm");
  for (const prmFile of prmFiles) {
    let text;
    try {
      text = await fs.readFile(path.join(scriptDir, ...prmFile.path.split("/")), "utf8");
    } catch (error) {
      warnings.push(`Gagal membaca file konfigurasi ${prmFile.path}: ${error.message}`);
      continue;
    }

    for (const section of parsePrm(text)) {
      const param = parameters.find((p) => p.name === section.name);
      if (!param) continue; // parameter tidak ditemukan di .dat mana pun; abaikan

      if (section.type) param.type = /** @type {any} */ (section.type);
      if (section.selectNextRow) param.selectNextRow = /** @type {any} */ (section.selectNextRow);
      if (section.updateValueOn) param.updateValueOn = /** @type {any} */ (section.updateValueOn);
      if (section.outOfRangePolicy) param.outOfRangePolicy = /** @type {any} */ (section.outOfRangePolicy);
    }
  }

  return { parameters, warnings };
}
