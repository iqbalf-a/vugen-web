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
  const url = step.request?.url;
  if (url) {
    try {
      const { pathname } = new URL(url);
      return `${(step.request?.method || "").toUpperCase()} ${pathname}`.trim();
    } catch {
      // URL tidak valid (mis. masih berisi {param}): pakai nama step
    }
  }
  return step.name || "(tanpa nama)";
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
