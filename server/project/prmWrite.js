/**
 * project/prmWrite.js — Ubah pengaturan sebuah parameter di file `.prm`:
 * Select next row (`SelectNextRow`), Update value on (`GenerateNewVal`), When out of values (`OutOfRangePolicy`).
 *
 * Hanya baris yang diubah yang disentuh; sisa file (urutan, komentar, EOL, encoding) dibiarkan apa adanya.
 * File dibaca sebagai latin1 supaya byte non-ASCII kembali persis sama saat ditulis.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { loadProject } from "./loader.js";
import { HttpError, resolveScriptFile } from "./paths.js";
import { atomicWrite, writeBackup } from "./save.js";

export const SELECT_NEXT_ROW = ["Sequential", "Random", "Unique", "SameLine"];
export const UPDATE_VALUE_ON = ["EachIteration", "EachOccurrence", "Once"];
/** Nama internal runner → token yang ditulis VuGen di .prm */
export const OUT_OF_RANGE_TOKEN = { Continue: "ContinueWithLast", Abort: "AbortVuser", Cycle: "CycleInSequence" };

/** Key kanonik → nama lain yang dikenali parser saat mencari baris yang sudah ada. */
const KEY_ALIASES = {
  SelectNextRow: ["SelectNextRow"],
  GenerateNewVal: ["GenerateNewVal", "UpdateValueOn"],
  OutOfRangePolicy: ["OutOfRangePolicy", "WhenOutOfValues"],
  Format: ["Format"],
  Offset: ["Offset"],
  Min: ["Min"],
  Max: ["Max"],
  StartValue: ["StartValue"],
  BlockSize: ["BlockSize"],
  DefaultValue: ["DefaultValue"],
};

const BOM = "\u00ef\u00bb\u00bf";

/**
 * @param {string} text isi .prm (latin1)
 * @param {string} name nama parameter
 * @param {Partial<Record<keyof typeof KEY_ALIASES, string>>} entries key kanonik → nilai (tanpa tanda kutip)
 * @returns {string | null} teks baru, atau null bila seksi `[parameter:name]` tidak ada
 */
export function setParameterKeys(text, name, entries) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const wanted = name.trim().toLowerCase();

  const start = lines.findIndex((line) => {
    const m = line.replace(BOM, "").trim().match(/^\[parameter:(.+)\]$/i);
    return m !== null && m[1].trim().toLowerCase() === wanted;
  });
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[.+\]\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const missing = [];
  for (const [key, value] of Object.entries(entries)) {
    const aliases = KEY_ALIASES[key].map((alias) => alias.toLowerCase());
    let replaced = false;
    for (let i = start + 1; i < end; i += 1) {
      const m = lines[i].match(/^\s*(\w+)\s*=/);
      if (m && aliases.includes(m[1].toLowerCase())) {
        lines[i] = `${m[1]}="${value}"`;
        replaced = true;
        break;
      }
    }
    if (!replaced) missing.push(`${key}="${value}"`);
  }

  if (missing.length > 0) {
    let insertAt = end;
    while (insertAt > start + 1 && lines[insertAt - 1].trim() === "") insertAt -= 1;
    lines.splice(insertAt, 0, ...missing);
  }
  return lines.join(eol);
}

/**
 * Validasi perubahan terhadap project lalu ubah jadi entri .prm.
 *
 * @param {Awaited<ReturnType<typeof loadProject>>["parameters"]} all
 * @param {any} param parameter yang diubah
 * @param {Record<string, unknown>} changes
 */
function buildEntries(all, param, changes) {
  /** @type {Record<string, string>} */
  const entries = {};

  if (changes.selectNextRow !== undefined) {
    const mode = changes.selectNextRow;
    if (typeof mode !== "string" || !SELECT_NEXT_ROW.includes(mode)) {
      throw new HttpError(400, `Select next row must be one of: Sequential, Random, Unique, or Same line as another parameter.`);
    }
    if (mode !== "SameLine") {
      entries.SelectNextRow = mode;
    } else {
      const parent = all.find((p) => p.name === changes.sameLineAs);
      if (!parent) throw new HttpError(404, `Parameter not found: ${String(changes.sameLineAs)}`);
      if (parent.name === param.name) throw new HttpError(400, "A parameter can't follow itself.");
      if (parent.selectNextRow === "SameLine") {
        throw new HttpError(409, `"${parent.name}" already follows "${parent.sameLineAs}", so it can't be a parent.`);
      }
      const follower = all.find((p) => p.selectNextRow === "SameLine" && p.sameLineAs === param.name);
      if (follower) {
        throw new HttpError(409, `"${follower.name}" follows "${param.name}", so "${param.name}" can't follow another parameter.`);
      }
      if (parent.rows !== param.rows) {
        throw new HttpError(
          409,
          `Row counts must match: "${param.name}" has ${param.rows} rows, "${parent.name}" has ${parent.rows}.`,
        );
      }
      entries.SelectNextRow = `Same line as ${parent.name}`;
    }
  }

  if (changes.updateValueOn !== undefined) {
    if (typeof changes.updateValueOn !== "string" || !UPDATE_VALUE_ON.includes(changes.updateValueOn)) {
      throw new HttpError(400, `Update value on must be one of: ${UPDATE_VALUE_ON.join(", ")}.`);
    }
    entries.GenerateNewVal = changes.updateValueOn;
  }

  if (changes.outOfRangePolicy !== undefined) {
    const token = typeof changes.outOfRangePolicy === "string" ? OUT_OF_RANGE_TOKEN[changes.outOfRangePolicy] : undefined;
    if (!token) throw new HttpError(400, `When out of values must be one of: ${Object.keys(OUT_OF_RANGE_TOKEN).join(", ")}.`);
    entries.OutOfRangePolicy = token;
  }

  if (changes.format !== undefined) {
    if (typeof changes.format !== "string") throw new HttpError(400, "format must be a string.");
    entries.Format = changes.format;
  }

  if (changes.offset !== undefined) {
    const n = Number(changes.offset);
    if (!Number.isFinite(n)) throw new HttpError(400, "offset must be a number.");
    entries.Offset = String(Math.round(n));
  }

  if (changes.min !== undefined) {
    const n = Number(changes.min);
    if (!Number.isFinite(n)) throw new HttpError(400, "min must be a number.");
    entries.Min = String(Math.round(n));
  }

  if (changes.max !== undefined) {
    const n = Number(changes.max);
    if (!Number.isFinite(n)) throw new HttpError(400, "max must be a number.");
    entries.Max = String(Math.round(n));
  }

  if (changes.startValue !== undefined) {
    const n = Number(changes.startValue);
    if (!Number.isFinite(n)) throw new HttpError(400, "startValue must be a number.");
    entries.StartValue = String(Math.round(n));
  }

  if (changes.blockSize !== undefined) {
    const n = Number(changes.blockSize);
    if (!Number.isFinite(n) || n < 1) throw new HttpError(400, "blockSize must be a positive number.");
    entries.BlockSize = String(Math.round(n));
  }

  if (changes.defaultValue !== undefined) {
    if (typeof changes.defaultValue !== "string") throw new HttpError(400, "defaultValue must be a string.");
    entries.DefaultValue = changes.defaultValue;
  }

  if (Object.keys(entries).length === 0) throw new HttpError(400, "No setting to change.");
  return entries;
}

/**
 * @param {string} scriptDir realpath folder script
 * @param {unknown} name
 * @param {Record<string, unknown>} changes { selectNextRow?, sameLineAs?, updateValueOn?, outOfRangePolicy? }
 */
export async function updateParameterSetting(scriptDir, name, changes) {
  if (typeof name !== "string" || name.trim() === "") {
    throw new HttpError(400, "Field name is required.");
  }

  const project = await loadProject(scriptDir);
  const param = project.parameters.find((p) => p.name === name);
  if (!param) throw new HttpError(404, `Parameter not found: ${name}`);
  if (!param.prmFile) {
    throw new HttpError(409, `Parameter "${name}" is not defined in a .prm file, so it has no settings to change.`);
  }

  const entries = buildEntries(project.parameters, param, changes ?? {});

  const { absolute, relative } = await resolveScriptFile(scriptDir, param.prmFile);
  const original = await fs.readFile(absolute);
  if ((original[0] === 0xff && original[1] === 0xfe) || (original[0] === 0xfe && original[1] === 0xff)) {
    throw new HttpError(400, `UTF-16 .prm files can't be edited: ${relative}`);
  }

  const next = setParameterKeys(original.toString("latin1"), name, entries);
  if (next === null) throw new HttpError(404, `No [parameter:${name}] section in ${relative}`);

  const buffer = Buffer.from(next, "latin1");
  if (!buffer.equals(original)) {
    await writeBackup(scriptDir, relative, original);
    await atomicWrite(absolute, buffer);
  }
  return { name, file: relative, ...entries };
}

/**
 * Buat parameter tipe File (Table): tulis file `.dat` baru + tambah seksi ke `.prm`.
 *
 * @param {string} scriptDir
 * @param {{ name: string, values: string[], selectNextRow?: string, updateValueOn?: string, outOfRangePolicy?: string }} paramDef
 */
export async function addFileParameter(scriptDir, paramDef) {
  const { name, values = [], selectNextRow = "Sequential", sameLineAs, updateValueOn = "EachIteration", outOfRangePolicy = "Cycle" } = paramDef;

  if (!name || typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name.trim())) {
    throw new HttpError(400, "Parameter name must start with a letter/underscore and contain only letters, digits, and underscores.");
  }
  if (!SELECT_NEXT_ROW.includes(selectNextRow)) {
    throw new HttpError(400, `selectNextRow must be one of: ${SELECT_NEXT_ROW.join(", ")}.`);
  }
  if (!UPDATE_VALUE_ON.includes(updateValueOn)) {
    throw new HttpError(400, `updateValueOn must be one of: ${UPDATE_VALUE_ON.join(", ")}.`);
  }

  const trimmedName = name.trim();

  // Cek duplikat parameter
  const project = await loadProject(scriptDir);
  if (project.parameters.some((p) => p.name === trimmedName)) {
    throw new HttpError(409, `Parameter "${trimmedName}" already exists.`);
  }

  // Validasi SameLine
  if (selectNextRow === "SameLine") {
    if (!sameLineAs) throw new HttpError(400, "sameLineAs is required when selectNextRow is SameLine.");
    const parent = project.parameters.find((p) => p.name === sameLineAs);
    if (!parent) throw new HttpError(404, `Parameter not found: ${sameLineAs}`);
    if (parent.selectNextRow === "SameLine") {
      throw new HttpError(409, `"${parent.name}" already follows "${parent.sameLineAs}", so it can't be a parent.`);
    }
    const newRows = values.filter((v) => String(v) !== "").length;
    if (parent.rows !== newRows) {
      throw new HttpError(409, `Row counts must match: new parameter has ${newRows} rows, "${parent.name}" has ${parent.rows}.`);
    }
  }

  // Tulis file .dat (nama file = nama parameter)
  const datFileName = `${trimmedName}.dat`;
  const datAbsolute = path.join(scriptDir, datFileName);
  try {
    await fs.access(datAbsolute);
    throw new HttpError(409, `File ${datFileName} already exists. Rename the existing file or choose a different parameter name.`);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // File belum ada — lanjut
  }

  const rows = values.map((v) => String(v)).filter((v) => v !== "");
  const datContent = [trimmedName, ...rows].join("\r\n") + "\r\n";
  await fs.writeFile(datAbsolute, datContent, "utf8");

  // Tambah seksi .prm
  const scriptName = path.basename(scriptDir);
  const prmFileName = `${scriptName}.prm`;
  const prmAbsolute = path.join(scriptDir, prmFileName);

  let existing = "";
  try {
    const buf = await fs.readFile(prmAbsolute);
    if ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) {
      throw new HttpError(400, `UTF-16 .prm files can't be edited: ${prmFileName}`);
    }
    existing = buf.toString("latin1");
  } catch (err) {
    if (err instanceof HttpError) throw err;
  }

  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const orp = OUT_OF_RANGE_TOKEN[outOfRangePolicy] ?? "CycleInSequence";
  const snrToken = selectNextRow === "SameLine"
    ? `Same line as ${sameLineAs}`
    : selectNextRow;
  const section =
    `${eol}[parameter:${trimmedName}]${eol}` +
    `Type="Table"${eol}` +
    `Table="${datFileName}"${eol}` +
    `ColumnName="${trimmedName}"${eol}` +
    `SelectNextRow="${snrToken}"${eol}` +
    `GenerateNewVal="${updateValueOn}"${eol}` +
    `OutOfRangePolicy="${orp}"${eol}`;

  await atomicWrite(prmAbsolute, Buffer.from(existing + section, "latin1"));
  return { name: trimmedName, type: "Table", file: datFileName, rows: rows.length };
}

const VALID_TYPES = new Set(["Time", "GroupName", "Userid", "Machine", "IterationNumber", "Custom", "RndNum", "UniqueNumber"]);

/**
 * Tambah parameter baru ke file `.prm` utama script.
 * Tipe Table tidak didukung di sini — parameter Table dibuat via file .dat.
 *
 * @param {string} scriptDir realpath folder script
 * @param {{ name: string, type: string, format?: string, offset?: number, updateValueOn?: string, min?: number, max?: number, startValue?: number, blockSize?: number, defaultValue?: string }} paramDef
 */
export async function addParameterToPrm(scriptDir, paramDef) {
  const { name, type, format, offset, updateValueOn, min, max, startValue, blockSize, defaultValue } = paramDef;

  if (!name || typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name.trim())) {
    throw new HttpError(400, "Parameter name must start with a letter/underscore and contain only letters, digits, and underscores.");
  }
  if (!VALID_TYPES.has(type)) {
    throw new HttpError(400, `Type must be one of: ${[...VALID_TYPES].join(", ")}.`);
  }

  // Cek duplikat
  const project = await loadProject(scriptDir);
  if (project.parameters.some((p) => p.name === name.trim())) {
    throw new HttpError(409, `Parameter "${name}" already exists.`);
  }

  // Tentukan file .prm utama (nama folder = nama script)
  const scriptName = path.basename(scriptDir);
  const prmFileName = `${scriptName}.prm`;
  const prmAbsolute = path.join(scriptDir, prmFileName);

  let existing = "";
  try {
    const buf = await fs.readFile(prmAbsolute);
    if ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) {
      throw new HttpError(400, `UTF-16 .prm files can't be edited: ${prmFileName}`);
    }
    existing = buf.toString("latin1");
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // File belum ada — mulai kosong
  }

  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  let section = `${eol}[parameter:${name.trim()}]${eol}Type="${type}"${eol}`;

  switch (type) {
    case "Time":
      section += `Format="${format || "%Y/%m/%d"}"${eol}`;
      section += `Offset="${offset ?? 0}"${eol}`;
      section += `GenerateNewVal="${updateValueOn || "EachIteration"}"${eol}`;
      break;
    case "RndNum":
      section += `Min="${min ?? 0}"${eol}`;
      section += `Max="${max ?? 100}"${eol}`;
      section += `UpdateValueOn="${updateValueOn || "EachIteration"}"${eol}`;
      break;
    case "UniqueNumber":
      section += `StartValue="${startValue ?? 0}"${eol}`;
      section += `BlockSize="${blockSize ?? 100}"${eol}`;
      break;
    case "Custom":
      section += `DefaultValue="${defaultValue ?? ""}"${eol}`;
      break;
    // GroupName, Userid, Machine, IterationNumber: tidak ada properti tambahan
  }

  const newContent = existing + section;
  await atomicWrite(prmAbsolute, Buffer.from(newContent, "latin1"));
  return { name: name.trim(), type, prmFile: prmFileName };
}
