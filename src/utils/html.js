/**
 * src/utils/html.js — util escape HTML untuk nilai yang masuk ke innerHTML.
 */

/** @type {Record<string, string>} */
const ENTITIES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
};

/**
 * Escape lima karakter berbahaya. Nilai non-string dikonversi dulu; null/undefined jadi "".
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
}
