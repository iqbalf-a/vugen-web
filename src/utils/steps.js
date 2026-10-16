/**
 * src/utils/steps.js — Pengelompokan step untuk daftar step.
 *
 * `vuser_init` dan `vuser_end` dijalankan dengan nomor iterasi 1 (sama dengan Action iterasi 1),
 * jadi nomor iterasi saja tidak cukup untuk memisahkannya. Pemisahnya adalah file asal step
 * (`step.file`) dibandingkan dengan file init/end dari Run Logic project.
 *
 * Grup tampil: `"init"` | `"end"` | nomor iterasi (1..N).
 *
 * @typedef {"init" | "end" | number} StepGroup
 */

/** @param {unknown} filePath @returns {string} nama file huruf kecil tanpa direktori */
function baseName(filePath) {
  return String(filePath ?? "").split(/[\\/]/).pop().toLowerCase();
}

/**
 * @param {{ file?: string, iteration?: number }} step
 * @param {{ init?: string, end?: string } | null | undefined} runLogic dari GET /api/project
 * @returns {StepGroup}
 */
export function stepGroupOf(step, runLogic) {
  const file = baseName(step.file);
  if (file !== "" && file === baseName(runLogic?.init ?? "vuser_init.c")) return "init";
  if (file !== "" && file === baseName(runLogic?.end ?? "vuser_end.c")) return "end";
  return step.iteration || 1;
}

/**
 * Daftar grup yang tersedia: init (bila ada step), iterasi 1..total, end (bila ada step).
 *
 * @param {{ file?: string, iteration?: number }[]} steps
 * @param {number} totalIterations
 * @param {{ init?: string, end?: string } | null | undefined} runLogic
 * @returns {StepGroup[]}
 */
export function availableGroups(steps, totalIterations, runLogic) {
  const present = new Set(steps.map((step) => stepGroupOf(step, runLogic)));
  const maxIteration = Math.max(1, totalIterations || 1, ...[...present].filter((group) => typeof group === "number"));
  /** @type {StepGroup[]} */
  const groups = [];
  if (present.has("init")) groups.push("init");
  for (let i = 1; i <= maxIteration; i++) groups.push(i);
  if (present.has("end")) groups.push("end");
  return groups;
}

/** @param {StepGroup} group */
export function groupLabel(group) {
  if (group === "init") return "vuser_init";
  if (group === "end") return "vuser_end";
  return `Iterasi ${group}`;
}

/**
 * Nama API untuk ditampilkan: `METHOD /path` dari endpoint request (tanpa host dan query string),
 * bukan nama step di script (mis. RPS_25_inquirylogin). Tanpa URL yang valid -> nama step.
 *
 * @param {{ name?: string, request?: { method?: string, url?: string } }} step
 * @returns {string}
 */
export function endpointLabel(step) {
  const { method, path } = endpointParts(step);
  return `${method} ${path}`.trim();
}

/**
 * Method dan path endpoint terpisah (untuk badge method di daftar step).
 * Tanpa URL yang valid: method kosong dan path = nama step.
 *
 * @param {{ name?: string, request?: { method?: string, url?: string } }} step
 * @returns {{ method: string, path: string }}
 */
export function endpointParts(step) {
  const url = step.request?.url;
  if (url) {
    try {
      return { method: (step.request?.method || "").toUpperCase(), path: new URL(url).pathname };
    } catch {
      // URL tidak valid (mis. masih berisi {param}): pakai nama step
    }
  }
  return { method: "", path: step.name || "(tanpa nama)" };
}

/**
 * Path dipendekkan dari DEPAN bila lebih dari `max` karakter: dua segmen terakhir dengan awalan "…/"
 * (ujung path biasanya pembeda antar API). Path lengkap tetap dipakai untuk tooltip.
 *
 * @param {string} path
 * @param {number} [max]
 */
export function shortPath(path, max = 22) {
  if (path.length <= max) return path;
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 2) return path;
  return `…/${segments.slice(-2).join("/")}`;
}

/** Durasi ringkas: < 10 ms satu desimal, selebihnya bilangan bulat. Contoh: 5.2ms, 24ms */
export function formatMs(value) {
  const ms = Number(value) || 0;
  return `${ms < 10 ? Math.round(ms * 10) / 10 : Math.round(ms)}ms`;
}

/**
 * Info identitas snapshot sebuah step, untuk header panel Snapshot.
 * - `number`: nomor snapshot = `step.seq` (unik per run; sama dengan "#N" di daftar step)
 * - `duplicate`: bila endpoint yang sama dipanggil >1 kali di grup (iterasi / init / end) yang sama,
 *   `{ index, total }` urutan pemanggilan itu (1-based); selain itu null
 *
 * @param {{ seq: number, file?: string, iteration?: number, request?: Object, name?: string }} step
 * @param {{ file?: string, iteration?: number, request?: Object, name?: string }[]} steps semua step run
 * @param {{ init?: string, end?: string } | null | undefined} runLogic
 * @returns {{ number: number, endpoint: string, group: StepGroup, duplicate: { index: number, total: number } | null }}
 */
export function snapshotInfo(step, steps, runLogic) {
  const endpoint = endpointLabel(step);
  const group = stepGroupOf(step, runLogic);
  const same = steps.filter((other) => stepGroupOf(other, runLogic) === group && endpointLabel(other) === endpoint);
  const index = same.findIndex((other) => other.seq === step.seq) + 1;
  return { number: step.seq, endpoint, group, duplicate: same.length > 1 && index > 0 ? { index, total: same.length } : null };
}

/**
 * Label status HTTP: "200", atau "404 Not Found" bila statusText ada.
 * statusText kosong (umum di HTTP/1.1 modern) tidak diberi tanda "-".
 *
 * @param {number|string|undefined} status
 * @param {string} [statusText]
 */
export function statusLabel(status, statusText) {
  const code = status || "-";
  return statusText ? `${code} ${statusText}` : String(code);
}
