/**
 * Loader folder script VuGen: daftar file + urutan Run Logic.
 *
 * PENTING (plan §6 + §4 aturan 4): format `.usr`/`default.usp` BELUM
 * diverifikasi dengan script VuGen nyata. Parser di bawah konservatif — hanya
 * menerima baris `key = <sesuatu>.c` yang jelas menunjuk file `.c`. Bila tidak
 * ada yang cocok, dipakai fallback `vuser_init.c → Action.c → vuser_end.c`
 * dan ditandai warning agar user tahu.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { cacheKeyFor, toPosix } from "./paths.js";

const SCRIPT_EXTENSIONS = new Set([".c", ".h"]);
const CONFIG_EXTENSIONS = new Set([".usr", ".cfg", ".usp", ".prm", ".dat"]);
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", ".cache", "result", "results"]);
const MAX_DEPTH = 4;
const MAX_FILES = 2000;

/** @typedef {{ key: string, file: string }} RunLogicEntry */

function classify(extension) {
  return SCRIPT_EXTENSIONS.has(extension) ? "script" : "config";
}

function isInitFile(name) {
  return name.toLowerCase() === "vuser_init.c";
}

function isEndFile(name) {
  return name.toLowerCase() === "vuser_end.c";
}

/**
 * Daftar file `.c`/`.h`/config di folder script (rekursif, kedalaman terbatas).
 *
 * @param {string} scriptDir
 */
async function listFiles(scriptDir) {
  /** @type {Array<{ path: string, name: string, ext: string, kind: "script" | "config", size: number, mtimeMs: number }>} */
  const files = [];
  /** @type {string[]} */
  const warnings = [];

  /**
   * @param {string} dir
   * @param {number} depth
   */
  async function walk(dir, depth) {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      const shown = toPosix(path.relative(scriptDir, dir)) || ".";
      warnings.push(`Tidak bisa membaca ${shown}: ${error.message}`);
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      const absolute = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name.toLowerCase())) continue;
        await walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!SCRIPT_EXTENSIONS.has(ext) && !CONFIG_EXTENSIONS.has(ext)) continue;

      const stats = await fs.stat(absolute);
      files.push({
        path: toPosix(path.relative(scriptDir, absolute)),
        name: entry.name,
        ext,
        kind: classify(ext),
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      });
    }
  }

  await walk(scriptDir, 0);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, warnings };
}

/**
 * Ambil baris `key = value` yang value-nya berakhiran `.c`.
 * Hanya itu yang kita anggap referensi file action.
 *
 * @param {string} text
 * @returns {RunLogicEntry[]}
 */
function parseConfigEntries(text) {
  /** @type {RunLogicEntry[]} */
  const entries = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("[") || line.startsWith(";") || line.startsWith("#")) continue;

    const match = /^([^=]+?)\s*=\s*(.+?)\s*$/.exec(line);
    if (!match) continue;

    const value = match[2].replace(/^["']|["']$/g, "").trim();
    if (!/\.c$/i.test(value)) continue;
    if (value.includes("\\") || value.includes("/")) continue;
    entries.push({ key: match[1].trim(), file: value });
  }
  return entries;
}

/**
 * Susun Run Logic dari daftar file + (bila ada) file konfigurasi.
 *
 * @param {string} scriptDir
 * @param {Array<{ path: string, name: string, kind: string }>} files
 */
async function resolveRunLogic(scriptDir, files) {
  /** @type {string[]} */
  const warnings = [];
  const known = new Set(files.map((file) => file.path));

  const configCandidates = files.filter(
    (file) => file.kind === "config" && (file.ext === ".usr" || file.name.toLowerCase() === "default.usp"),
  );

  /** @type {RunLogicEntry[]} */
  let entries = [];
  /** @type {string | null} */
  let configFile = null;

  for (const candidate of configCandidates) {
    let text;
    try {
      text = await fs.readFile(path.join(scriptDir, candidate.path), "utf8");
    } catch {
      continue;
    }
    const parsed = parseConfigEntries(text);
    if (parsed.length > 0) {
      entries = parsed;
      configFile = candidate.path;
      break;
    }
  }

  // Fallback (plan §6): init → Action → end.
  if (entries.length === 0) {
    if (configCandidates.length > 0) {
      warnings.push(
        `Run Logic tidak terbaca dari ${configCandidates.map((file) => file.path).join(", ")}; memakai fallback vuser_init/Action/vuser_end. Format perlu diverifikasi dengan script VuGen nyata.`,
      );
    }
    entries = [known.has("vuser_init.c") ? { key: "init", file: "vuser_init.c" } : null, { key: "action", file: "Action.c" }, known.has("vuser_end.c") ? { key: "end", file: "vuser_end.c" } : null].filter(
      (entry) => entry !== null && known.has(entry.file),
    );
    return buildRunLogic("fallback", null, entries, warnings);
  }

  const missing = entries.filter((entry) => !known.has(entry.file));
  if (missing.length > 0) {
    warnings.push(`Run Logic menunjuk file yang tidak ada: ${missing.map((entry) => entry.file).join(", ")}.`);
  }

  return buildRunLogic("config", configFile, entries, warnings);
}

/**
 * @param {"config" | "fallback"} source
 * @param {string | null} configFile
 * @param {RunLogicEntry[]} entries
 * @param {string[]} warnings
 */
function buildRunLogic(source, configFile, entries, warnings) {
  const init = entries.find((entry) => isInitFile(entry.file));
  const end = entries.find((entry) => isEndFile(entry.file));
  const actions = entries.filter((entry) => !isInitFile(entry.file) && !isEndFile(entry.file));

  return {
    source,
    configFile,
    init: init ? init.file : null,
    actions: actions.map((entry) => ({ name: entry.key, file: entry.file })),
    end: end ? end.file : null,
    warnings,
  };
}

/**
 * Susun daftar action dari file `.c` di root folder script (di luar init/end).
 *
 * @param {Array<{ path: string, name: string, ext: string }>} files
 */
function collectActions(files) {
  const rootScripts = files.filter((file) => file.ext === ".c" && !file.path.includes("/"));
  const actions = rootScripts.filter((file) => !isInitFile(file.name) && !isEndFile(file.name));
  // Action.c didahulukan karena itu action utama pada script VuGen umum.
  actions.sort((a, b) => {
    if (a.name === "Action.c") return -1;
    if (b.name === "Action.c") return 1;
    return a.name.localeCompare(b.name);
  });
  return actions.map((file) => ({ name: path.basename(file.name, ".c"), file: file.path }));
}

/**
 * @param {string} scriptDir
 */
export async function loadProject(scriptDir) {
  const { files, warnings } = await listFiles(scriptDir);
  const runLogic = await resolveRunLogic(scriptDir, files);

  const runActions = runLogic.actions;
  const actions = runActions.length > 0 ? runActions : collectActions(files);

  return {
    path: scriptDir,
    cacheKey: cacheKeyFor(scriptDir),
    files,
    actions,
    runLogic,
    warnings: [...warnings, ...runLogic.warnings],
  };
}
