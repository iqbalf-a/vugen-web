/**
 * project/parameters.js — Baca file parameter `.dat` dan konfigurasi `.prm` script VuGen.
 *
 * Format `.dat`: baris pertama SELALU header (nama kolom dipisah koma), baris berikutnya nilai.
 * Format `.prm`: INI-style dengan seksi `[parameter:NAME]` dan key=value.
 *
 * Prioritas: `.prm` mendefinisikan nama parameter yang dipakai script (`{companyId}`),
 * file sumber (`Table=companyId.dat`), dan kolom (`ColumnName="Col 1"` = kolom ke-1,
 * atau `ColumnName="compId"` = kolom bernama "compId").
 * `.dat` tanpa entri `.prm` di-load menggunakan nama kolom header sebagai nama parameter.
 *
 * @typedef {Object} ParameterDef
 * @property {string} name - nama parameter (dari .prm atau header .dat)
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
 * @returns {{ name: string, type: string, table: string|null, columnName: string|null, selectNextRow: string, updateValueOn: string, outOfRangePolicy: string }[]}
 */
export function parsePrm(text) {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = withoutBom.split(/\r?\n/);

  /** @type {{ name: string, type: string, table: string|null, columnName: string|null, selectNextRow: string, updateValueOn: string, outOfRangePolicy: string }[]} */
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
        columnName: null,
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
      case "columnname":
        current.columnName = val || null;
        break;
      case "selectnextrow":
        // "Same line as X" → Sequential (synchronized multi-param tidak didukung, fallback)
        current.selectNextRow = val.toLowerCase().startsWith("same line") ? "Sequential" : val;
        break;
      case "updatevalueon":
      case "generatenewval":
        current.updateValueOn = val;
        break;
      case "whenoutofvalues":
      case "outofrangepolicy":
        // "ContinueWithLast" → "Continue"
        current.outOfRangePolicy = val === "ContinueWithLast" ? "Continue" : val;
        break;
    }
  }

  return sections;
}

/**
 * Pilih nilai dari kolom `.dat` berdasarkan `columnName` dari `.prm`.
 * - `"Col N"` → ambil kolom ke-N (1-based)
 * - nama lain → cari kolom dengan header yang cocok (case-insensitive)
 * - null/tidak ada → kolom pertama
 *
 * @param {{ name: string, values: string[] }[]} columns
 * @param {string|null} columnName
 * @returns {{ name: string, values: string[] }|null}
 */
function pickColumn(columns, columnName) {
  if (!columns.length) return null;
  if (!columnName) return columns[0];

  // "Col N" → ambil kolom ke-N (1-based)
  const colNumMatch = columnName.match(/^Col\s+(\d+)$/i);
  if (colNumMatch) {
    const idx = parseInt(colNumMatch[1], 10) - 1;
    return columns[idx] ?? columns[0];
  }

  // Cari berdasarkan nama header (case-insensitive)
  const found = columns.find((c) => c.name.toLowerCase() === columnName.toLowerCase());
  return found ?? columns[0];
}

/**
 * Baca semua `.dat` di root script dan `data/`, lalu terapkan konfigurasi dari `.prm`.
 *
 * Prioritas: `.prm` mendefinisikan nama parameter canonical. Untuk setiap seksi `.prm`
 * yang memiliki `Table=file.dat`, nilai diambil dari kolom yang ditentukan `ColumnName`.
 * `.dat` tanpa entri `.prm` di-load menggunakan nama kolom header.
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

  // Cache isi .dat yang sudah dibaca (POSIX path → columns)
  const datCache = new Map();
  async function readDat(relPath) {
    if (datCache.has(relPath)) return datCache.get(relPath);
    try {
      const text = await fs.readFile(path.join(scriptDir, ...relPath.split("/")), "utf8");
      const cols = parseDat(text);
      datCache.set(relPath, cols);
      return cols;
    } catch (error) {
      warnings.push(`Gagal membaca file parameter ${relPath}: ${error.message}`);
      datCache.set(relPath, null);
      return null;
    }
  }

  // Kumpulkan semua .dat yang tersedia (POSIX relative path)
  const allDatPaths = new Set(
    files
      .filter((f) => f.ext === ".dat" && (f.path.startsWith("data/") || !f.path.includes("/")))
      .map((f) => f.path)
  );

  // ── Langkah 1: Proses entri .prm (parameter canonical) ─────────────────────
  const paramsByName = new Map(); // name → ParameterDef (untuk dedup)
  const datCoveredByPrm = new Set(); // dat files yang sudah dihandle .prm

  const prmFiles = files.filter((f) => f.ext === ".prm");
  for (const prmFile of prmFiles) {
    let prmText;
    try {
      prmText = await fs.readFile(path.join(scriptDir, ...prmFile.path.split("/")), "utf8");
    } catch (error) {
      warnings.push(`Gagal membaca file konfigurasi ${prmFile.path}: ${error.message}`);
      continue;
    }

    for (const section of parsePrm(prmText)) {
      if (section.type !== "Table" || !section.table) continue; // hanya Table type dengan file

      // Cari file .dat yang sesuai (match case-insensitive di root dan data/)
      const candidates = [...allDatPaths].filter(
        (p) => p.toLowerCase() === section.table.toLowerCase() ||
               p.toLowerCase() === `data/${section.table.toLowerCase()}`
      );
      const datPath = candidates[0] ?? null;

      if (!datPath) {
        warnings.push(`Parameter "${section.name}": file ${section.table} tidak ditemukan`);
        continue;
      }

      const columns = await readDat(datPath);
      if (!columns) continue;

      const col = pickColumn(columns, section.columnName);
      if (!col) {
        warnings.push(`Parameter "${section.name}": kolom "${section.columnName}" tidak ditemukan di ${datPath}`);
        continue;
      }

      if (paramsByName.has(section.name)) {
        const prevSource = paramsByName.get(section.name) ?? "sumber lain";
        warnings.push(`Parameter "${section.name}" di ${datPath} diabaikan; sudah ada dari ${prevSource}`);
        continue;
      }

      datCoveredByPrm.add(datPath);

      const param = {
        name: section.name,
        file: datPath,
        rows: col.values.length,
        values: col.values,
        type: /** @type {any} */ (section.type),
        selectNextRow: /** @type {any} */ (section.selectNextRow),
        updateValueOn: /** @type {any} */ (section.updateValueOn),
        outOfRangePolicy: /** @type {any} */ (section.outOfRangePolicy),
      };
      paramsByName.set(section.name, datPath);
      parameters.push(param);
    }
  }

  // ── Langkah 2: .dat tanpa entri .prm → load dengan nama kolom header ───────
  const datWithoutPrm = [...allDatPaths]
    .filter((p) => !datCoveredByPrm.has(p))
    .sort((a, b) => Number(a.includes("/")) - Number(b.includes("/"))); // root lebih dulu

  for (const datPath of datWithoutPrm) {
    const columns = await readDat(datPath);
    if (!columns) continue;

    for (const col of columns) {
      if (paramsByName.has(col.name)) {
        const prevSrc = paramsByName.get(col.name);
        const srcLabel = prevSrc && typeof prevSrc === "string" ? prevSrc : prevSrc?.file ?? "sumber lain";
        warnings.push(`Parameter "${col.name}" di ${datPath} diabaikan; sudah dibaca dari ${srcLabel}.`);
        continue;
      }
      paramsByName.set(col.name, datPath);
      parameters.push({ name: col.name, file: datPath, rows: col.values.length, values: col.values });
    }
  }

  // ── Langkah 3: .prm tanpa Table= → config overlay untuk param dari .dat ───
  for (const prmFile of prmFiles) {
    let prmText;
    try {
      prmText = await fs.readFile(path.join(scriptDir, ...prmFile.path.split("/")), "utf8");
    } catch {
      continue; // sudah dicatat di langkah 1
    }
    for (const section of parsePrm(prmText)) {
      if (section.table) continue; // sudah diproses di langkah 1
      const param = parameters.find((p) => p.name === section.name);
      if (!param) continue;
      if (section.selectNextRow) param.selectNextRow = /** @type {any} */ (section.selectNextRow);
      if (section.updateValueOn) param.updateValueOn = /** @type {any} */ (section.updateValueOn);
      if (section.outOfRangePolicy) param.outOfRangePolicy = /** @type {any} */ (section.outOfRangePolicy);
    }
  }

  return { parameters, warnings };
}
