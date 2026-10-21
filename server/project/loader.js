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
import { loadParameters } from "./parameters.js";
import { MAX_SCAN_BYTES, layoutFiles, parseUsr } from "./structure.js";

const SCRIPT_EXTENSIONS = new Set([".c", ".h"]);
const CONFIG_EXTENSIONS = new Set([".usr", ".cfg", ".usp", ".prm", ".dat"]);
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", ".cache", "result", "results"]);
// Skip preprocessed/combined files that duplicate function definitions
const SKIP_FILES = new Set([
  "pre_cci.c",
  "combined_",
  "pre_cci.h",
  "combined.h",
]);
const MAX_DEPTH = 4;
const MAX_FILES = 2000;

/** @typedef {{ key: string, file: string }} RunLogicEntry */

function classify(extension) {
  return SCRIPT_EXTENSIONS.has(extension) || extension === ".js" ? "script" : "config";
}

/**
 * Baca `.usr` di root folder (bila ada) untuk daftar action dan Extra Files.
 *
 * @param {string} scriptDir
 */
async function readUsr(scriptDir) {
  try {
    const entries = await fs.readdir(scriptDir);
    const usr = entries.filter((name) => name.toLowerCase().endsWith(".usr")).sort()[0];
    if (!usr) return { actions: null, extraFiles: [] };
    return parseUsr(await fs.readFile(path.join(scriptDir, usr), "latin1"));
  } catch {
    return { actions: null, extraFiles: [] };
  }
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
 * @param {Set<string>} extraListed path (huruf kecil) dari `[ExtraFiles]`; ikut didaftar apa pun ekstensinya
 */
async function listFiles(scriptDir, extraListed = new Set()) {
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
      const relative = toPosix(path.relative(scriptDir, absolute));
      const accepted =
        SCRIPT_EXTENSIONS.has(ext) ||
        CONFIG_EXTENSIONS.has(ext) ||
        extraListed.has(relative.toLowerCase()) ||
        (ext === ".js" && depth === 0);
      if (!accepted) continue;

      // Skip preprocessed/combined files
      const lowerName = entry.name.toLowerCase();
      if (Array.from(SKIP_FILES).some(skip => lowerName.startsWith(skip))) continue;

      const stats = await fs.stat(absolute);
      files.push({
        path: relative,
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
 * Parse file konfigurasi VuGen (.usp, .cfg) untuk ekstrak Run Logic.
 * Format .usp: INI-style dengan section [RunLogicRunRoot] dan key RunLogicActionOrder.
 *
 * @param {string} text
 * @returns {RunLogicEntry[]}
 */
function parseConfigEntries(text) {
  /** @type {RunLogicEntry[]} */
  const entries = [];
  const lines = text.split(/\r?\n/);
  let currentSection = "";
  let runLogicRunRootEntries = [];
  let runLogicInitEntries = [];
  let runLogicEndEntries = [];


  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith(";") || line.startsWith("#")) continue;

    // Section header: [SectionName] or [SectionName:SubName]
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }

    // Key = Value
    const match = /^([^=]+?)\s*=\s*(.+?)\s*$/.exec(line);
    if (!match) continue;

    const key = match[1].trim();
    const value = match[2].replace(/^["']|["']$/g, "").trim();

    // Parse RunLogicRunRoot section - MAIN ACTIONS
    if (currentSection === "RunLogicRunRoot") {
      if (key === "RunLogicActionOrder") {
        const actions = value.split(",").map(a => a.trim()).filter(a => a);
        for (const action of actions) {
          runLogicRunRootEntries.push({ key: action, file: action + ".c" });
        }
      }
      continue;
    }

    // Parse RunLogicRunRoot subsections - [RunLogicRunRoot:ActionName]
    if (currentSection.startsWith("RunLogicRunRoot:") && key === "Name") {
      runLogicRunRootEntries.push({ key: value, file: value + ".c" });
      continue;
    }

    // Parse RunLogicInitRoot section - INIT ACTIONS
    if (currentSection === "RunLogicInitRoot") {
      if (key === "RunLogicActionOrder") {
        const actions = value.split(",").map(a => a.trim()).filter(a => a);
        for (const action of actions) {
          runLogicInitEntries.push({ key: action, file: action + ".c" });
        }
      }
      continue;
    }

    // Parse RunLogicInitRoot subsections
    if (currentSection.startsWith("RunLogicInitRoot:") && key === "Name") {
      runLogicInitEntries.push({ key: value, file: value + ".c" });
      continue;
    }

    // Parse RunLogicEndRoot section - END ACTIONS
    if (currentSection === "RunLogicEndRoot") {
      if (key === "RunLogicActionOrder") {
        const actions = value.split(",").map(a => a.trim()).filter(a => a);
        for (const action of actions) {
          runLogicEndEntries.push({ key: action, file: action + ".c" });
        }
      }
      continue;
    }

    // Parse RunLogicEndRoot subsections
    if (currentSection.startsWith("RunLogicEndRoot:") && key === "Name") {
      runLogicEndEntries.push({ key: value, file: value + ".c" });
      continue;
    }

    // Generic .c file references (fallback) - only if no RunLogic entries yet
    if (/\.c$/i.test(value) && !value.includes("\\") && !value.includes("/") 
        && runLogicRunRootEntries.length === 0 
        && runLogicInitEntries.length === 0 
        && runLogicEndEntries.length === 0) {
      entries.push({ key, file: value });
    }
  }

  // Deduplicate by file
  const seen = new Set();
  const dedupe = (arr) => arr.filter(e => {
    if (seen.has(e.file)) return false;
    seen.add(e.file);
    return true;
  });

  const runRoot = dedupe(runLogicRunRootEntries);
  const runInit = dedupe(runLogicInitEntries);
  const runEnd = dedupe(runLogicEndEntries);


  // Combine: init + main actions + end
  return [...runInit, ...runRoot, ...runEnd];
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
  ).sort((a, b) => {
    // Prioritize default.usp > .usp > others
    const aIsUsp = a.name.toLowerCase() === "default.usp";
    const bIsUsp = b.name.toLowerCase() === "default.usp";
    if (aIsUsp && !bIsUsp) return -1;
    if (!aIsUsp && bIsUsp) return 1;
    const aIsUspExt = a.ext === ".usp";
    const bIsUspExt = b.ext === ".usp";
    if (aIsUspExt && !bIsUspExt) return -1;
    if (!aIsUspExt && bIsUspExt) return 1;
    return 0;
  });

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

export async function loadProject(scriptDir) {
  const usr = await readUsr(scriptDir);
  const extraListed = new Set(usr.extraFiles.map((file) => file.toLowerCase()));
  const { files, warnings } = await listFiles(scriptDir, extraListed);
  const runLogic = await resolveRunLogic(scriptDir, files);

  const runActions = runLogic.actions;
  const actions = runActions.length > 0 ? runActions : collectActions(files);

  const rootFile = (name) => files.find((file) => file.path === name)?.path ?? null;
  const ctx = {
    init: runLogic.init ?? rootFile("vuser_init.c"),
    end: runLogic.end ?? rootFile("vuser_end.c"),
    runActions: actions.map((action) => action.file),
    listed: usr.actions,
    extraListed: new Set(usr.extraFiles),
  };
  /** @type {Map<string, string>} */
  const texts = new Map();
  for (const file of files) {
    if (file.ext !== ".c" || file.path.includes("/") || file.size > MAX_SCAN_BYTES) continue;
    try {
      texts.set(file.path, await fs.readFile(path.join(scriptDir, file.path), "latin1"));
    } catch {
      // File tak terbaca: dilewati, hanya memengaruhi daftar pemanggil.
    }
  }
  const layout = layoutFiles(files, ctx, texts);
  const categorizedFiles = files.map((file) => ({ ...file, ...layout.get(file.path) }));

  const { parameters, warnings: parameterWarnings } = await loadParameters(scriptDir, files);

  return {
    path: scriptDir,
    cacheKey: cacheKeyFor(scriptDir),
    files: categorizedFiles,
    actions,
    runLogic,
    parameters,
    warnings: [...warnings, ...runLogic.warnings, ...parameterWarnings],
  };
}
