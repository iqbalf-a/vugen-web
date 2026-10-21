import { escapeHtml } from "./html.js";

/**
 * src/utils/toolbox.js — Normalisasi, filter, dan pengelompokan data fungsi Step Toolbox.
 */

/**
 * Gabungkan modul JSON hasil `import.meta.glob` menjadi satu daftar fungsi terurut.
 * Entri tanpa nama dibuang; nama duplikat diambil yang pertama.
 *
 * @param {Record<string, unknown>} modules
 * @returns {Array<object>}
 */
export function collectFunctions(modules) {
  const seen = new Set();
  const out = [];
  for (const mod of Object.values(modules)) {
    const list = Array.isArray(mod) ? mod : Array.isArray(mod?.default) ? mod.default : [];
    for (const fn of list) {
      if (!fn || typeof fn.name !== "string" || !fn.name || seen.has(fn.name)) continue;
      seen.add(fn.name);
      out.push(fn);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Filter fungsi berdasarkan teks (nama, kategori, deskripsi).
 *
 * @param {Array<object>} functions
 * @param {string} query
 * @returns {Array<object>}
 */
export function filterFunctions(functions, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return functions;
  return functions.filter(fn =>
    fn.name.toLowerCase().includes(q)
    || String(fn.category ?? "").toLowerCase().includes(q)
    || String(fn.description ?? "").toLowerCase().includes(q));
}

const CATEGORY_ORDER = [
  "Web: Requests & Navigation",
  "Web: Correlation & Verification",
  "Web: Headers, Cookies, Cache & Settings",
  "Web: Streaming",
  "Web: Web Service (SOAP)",
  "LoadRunner (lr_)",
];

/** Kategori yang paling sering dipakai di script VuGen tampil lebih dulu; sisanya urut abjad */
function categoryRank(category) {
  const index = CATEGORY_ORDER.indexOf(category);
  return index < 0 ? CATEGORY_ORDER.length : index;
}

/**
 * Kelompokkan per kategori (kategori umum VuGen lebih dulu, sisanya urut abjad).
 *
 * @param {Array<object>} functions
 * @returns {Array<{ category: string, items: Array<object> }>}
 */
export function groupByCategory(functions) {
  const map = new Map();
  for (const fn of functions) {
    const category = fn.category || "Other";
    if (!map.has(category)) map.set(category, []);
    map.get(category).push(fn);
  }
  return [...map.entries()]
    .sort(([a], [b]) => categoryRank(a) - categoryRank(b) || a.localeCompare(b))
    .map(([category, items]) => ({ category, items }));
}

/**
 * Nama fungsi sebagai HTML aman dengan bagian yang cocok query dibungkus <mark>.
 *
 * @param {string} name
 * @param {string} query
 * @returns {string}
 */
export function markMatch(name, query) {
  const q = String(query ?? "").trim().toLowerCase();
  const at = q ? name.toLowerCase().indexOf(q) : -1;
  if (at < 0) return escapeHtml(name);
  return `${escapeHtml(name.slice(0, at))}<mark>${escapeHtml(name.slice(at, at + q.length))}</mark>${escapeHtml(name.slice(at + q.length))}`;
}
