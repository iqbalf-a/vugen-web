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
 * @property {string} [column] - nama kolom header di .dat
 * @property {string|null} [prmFile] - .prm yang mendefinisikan parameter ini (null bila hanya dari header .dat)
 * @property {string[]} values - nilai per baris (hanya untuk runner; tidak dikirim ke browser)
 * @property {"Table"|"Time"|"Userid"} [type] - tipe dari .prm (default "Table")
 * @property {string} [timeFormat] - format string untuk Type=Time: %Y %m %d %H %M %S
 * @property {number} [timeOffsetSec] - offset detik untuk Type=Time (negatif = masa lalu)
 * @property {"Sequential"|"Random"|"Unique"|"SameLine"} [selectNextRow] - strategi pilih baris (default "Sequential")
 * @property {string|null} [sameLineAs] - parameter induk bila selectNextRow = "SameLine" (baris selalu sama dengan induk)
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

/** Token VuGen di .prm → nama internal runner. */
const OUT_OF_RANGE_TOKENS = { continuewithlast: "Continue", abortvuser: "Abort", cycleinsequence: "Cycle" };

/**
 * Parse isi satu file `.prm` (format INI VuGen).
 * Menghasilkan satu entri per seksi `[parameter:NAME]`.
 *
 * @param {string} text
 * @returns {{ name: string, type: string, table: string|null, columnName: string|null, format: string|null, offset: number, selectNextRow: string, sameLineAs: string|null, updateValueOn: string, outOfRangePolicy: string }[]}
 */
export function parsePrm(text) {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = withoutBom.split(/\r?\n/);

  /** @type {ReturnType<typeof parsePrm>} */
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
        format: null,
        offset: 0,
        selectNextRow: "Sequential",
        sameLineAs: null,
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
      case "format":
        current.format = val || null;
        break;
      case "offset":
        current.offset = val ? (parseInt(val, 10) || 0) : 0;
        break;
      case "selectnextrow": {
        const same = val.match(/^same line as\s+(.+)$/i);
        current.selectNextRow = same ? "SameLine" : val;
        current.sameLineAs = same ? same[1].trim() : null;
        break;
      }
      case "updatevalueon":
      case "generatenewval":
        current.updateValueOn = val;
        break;
      case "whenoutofvalues":
      case "outofrangepolicy":
        current.outOfRangePolicy = OUT_OF_RANGE_TOKENS[val.toLowerCase()] ?? val;
        break;
    }
  }

  return sections;
}

/**
 * Hitung nilai parameter Type=Time berdasarkan format strftime dan offset detik.
 *
 * @param {string|null} format - format string VuGen: %Y %m %d %H %M %S
 * @param {number} [offsetSec] - detik tambah/kurang dari waktu sekarang
 * @returns {string}
 */
export function computeTimeValue(format, offsetSec = 0) {
  const d = new Date(Date.now() + offsetSec * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return (format || "%Y/%m/%d")
    .replace(/%Y/g, String(d.getFullYear()))
    .replace(/%m/g, pad(d.getMonth() + 1))
    .replace(/%d/g, pad(d.getDate()))
    .replace(/%H/g, pad(d.getHours()))
    .replace(/%M/g, pad(d.getMinutes()))
    .replace(/%S/g, pad(d.getSeconds()));
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
      // Type=Time: nilai dihitung dari waktu saat ini + offset, tanpa file .dat
      if (section.type === "Time") {
        if (paramsByName.has(section.name)) {
          warnings.push(`Parameter "${section.name}" (Time) diabaikan; sudah ada.`);
          continue;
        }
        const value = computeTimeValue(section.format, section.offset);
        paramsByName.set(section.name, "(Time)");
        parameters.push({
          name: section.name,
          file: "",
          rows: 1,
          values: [value],
          column: null,
          prmFile: prmFile.path,
          type: "Time",
          timeFormat: section.format ?? "%Y/%m/%d",
          timeOffsetSec: section.offset ?? 0,
          selectNextRow: "Sequential",
          sameLineAs: null,
          updateValueOn: /** @type {any} */ (section.updateValueOn),
          outOfRangePolicy: "Cycle",
        });
        continue;
      }

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
        column: col.name,
        prmFile: prmFile.path,
        type: /** @type {any} */ (section.type),
        selectNextRow: /** @type {any} */ (section.selectNextRow),
        sameLineAs: section.sameLineAs,
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
      parameters.push({ name: col.name, file: datPath, rows: col.values.length, values: col.values, column: col.name, prmFile: null });
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
      if (section.table || section.type === "Time") continue; // sudah diproses di langkah 1
      const param = parameters.find((p) => p.name === section.name);
      if (!param) continue;
      param.prmFile = prmFile.path;
      if (section.selectNextRow) param.selectNextRow = /** @type {any} */ (section.selectNextRow);
      param.sameLineAs = section.sameLineAs;
      if (section.updateValueOn) param.updateValueOn = /** @type {any} */ (section.updateValueOn);
      if (section.outOfRangePolicy) param.outOfRangePolicy = /** @type {any} */ (section.outOfRangePolicy);
    }
  }

  // "Same line as X": induk harus ada dan jumlah barisnya sama, kalau tidak jatuh ke Sequential.
  for (const param of parameters) {
    if (param.selectNextRow !== "SameLine") continue;
    const parent = parameters.find((p) => p.name === param.sameLineAs);
    const problem = !parent
      ? `parameter "${param.sameLineAs}" not found`
      : parent === param || parent.selectNextRow === "SameLine"
        ? `parameter "${param.sameLineAs}" can't be a parent`
        : parent.rows !== param.rows
          ? `row counts differ (${param.rows} vs ${parent.rows} in "${parent.name}")`
          : null;
    if (problem) {
      warnings.push(`Parameter "${param.name}": ignoring "Same line as ${param.sameLineAs}" (${problem}); using Sequential.`);
      param.selectNextRow = "Sequential";
      param.sameLineAs = null;
    }
  }

  return { parameters, warnings };
}
