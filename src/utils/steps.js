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
