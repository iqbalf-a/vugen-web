/**
 * compiler/referenced-params.js — Nama parameter VuGen yang dirujuk source script.
 *
 * Dipakai untuk memuat nilai `.dat` hanya bagi parameter yang benar-benar dipakai script
 * (file `.dat` sisa/tidak dideklarasikan tidak ikut menjadi parameter).
 */

/** `{nama}` di string/kode (nama: huruf/angka/_ . -), serta LR.getParam('nama') di web_js_run */
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g;
const GET_PARAM = /LR\.getParam\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * @param {string} source teks file .c / .h
 * @param {Set<string>} [into] himpunan yang diisi
 * @returns {Set<string>}
 */
export function findReferencedParams(source, into = new Set()) {
  for (const match of source.matchAll(PLACEHOLDER)) into.add(match[1]);
  for (const match of source.matchAll(GET_PARAM)) into.add(match[1]);
  return into;
}
