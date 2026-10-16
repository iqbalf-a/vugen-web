/**
 * src/utils/params.js — Nilai parameter VuGen pada sebuah step, dari perubahan yang dibawa tiap step.
 *
 * Event `step` membawa `params`: perubahan parameter sejak step sebelumnya
 * (`lr_save_string`, correlation, `.dat`, ...). Nilai pada step N = semua perubahan dari step 1..N
 * diterapkan berurutan (nilai yang diisi berulang kali, mis. transName, selalu nilai terbaru).
 *
 * @typedef {Object} ParamRow
 * @property {string} name
 * @property {string} value
 * @property {string} [source] asal nilai ("lr_save_string", "web_reg_save_param (regexp)", ".dat: ip.dat", ...)
 * @property {string} [file]
 * @property {number} [line]
 */

/**
 * @param {{ seq: number, params?: Object[] }[]} steps semua step run (urutan seq naik)
 * @param {number} [uptoSeq] sampai step ini (inklusif); kosong = semua step
 * @returns {ParamRow[]} satu baris per parameter yang ada pada saat itu
 */
export function paramsAtStep(steps, uptoSeq = Infinity) {
  /** @type {Map<string, ParamRow>} */
  const state = new Map();
  for (const step of steps) {
    if (step.seq > uptoSeq) break;
    for (const change of step.params ?? []) {
      if (change.removed) state.delete(change.name);
      else state.set(change.name, { name: change.name, value: String(change.value ?? ""), source: change.source, file: change.file, line: change.line });
    }
  }
  return [...state.values()];
}

/**
 * Parameter pada akhir run: nilai akhir dari `run.params` (termasuk perubahan sesudah step terakhir),
 * dengan asal-usul dari perubahan terakhir yang tercatat di step bila ada.
 *
 * @param {{ steps?: { seq: number, params?: Object[] }[], params?: Record<string, string> }} run
 * @returns {ParamRow[]}
 */
export function paramsAtEnd(run) {
  const fromSteps = new Map(paramsAtStep(run.steps ?? []).map((row) => [row.name, row]));
  if (!run.params) return [...fromSteps.values()];
  return Object.entries(run.params).map(([name, value]) => ({ ...fromSteps.get(name), name, value: String(value ?? "") }));
}

/**
 * Urutkan baris menurut nama (tidak peka huruf besar/kecil, angka secara numerik: id_2 < id_10).
 * @template {{ name: string }} T
 * @param {T[]} rows
 * @param {"asc" | "desc"} direction
 * @returns {T[]}
 */
export function sortByName(rows, direction = "asc") {
  const sign = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => sign * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || sign * (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
