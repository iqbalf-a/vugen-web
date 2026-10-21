/**
 * Struktur folder script untuk pengelompokan di UI. Mengikuti model VuGen:
 * semua action setara; bedanya hanya aktif (ada di Run Logic) atau pasif (ada di script
 * tetapi hanya dijalankan bila dipanggil, mis. Loadpage). Extra Files = `[ExtraFiles]`
 * di `.usr` (header, `.js`, gambar, dst.) yang bisa dimuat langsung oleh script.
 */

export const MAX_SCAN_BYTES = 2 * 1024 * 1024;

/** @param {string} name */
const baseName = (name) => name.replace(/\.[^.]+$/, "");

/** @param {string} value */
export const toRelative = (value) => value.trim().replace(/\\/g, "/").replace(/^\.\//, "");

/** @param {string} text */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, " ");
}

/**
 * Baca bagian `[Actions]` dan `[ExtraFiles]` dari isi file `.usr`.
 *
 * @param {string} text
 * @returns {{ actions: string[] | null, extraFiles: string[] }}
 */
export function parseUsr(text) {
  /** @type {string[] | null} */
  let actions = null;
  /** @type {string[]} */
  const extraFiles = [];
  let section = "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = header[1];
      if (section === "Actions") actions = [];
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();

    if (section === "Actions" && /\.c$/i.test(value)) actions?.push(toRelative(value));
    if (section === "ExtraFiles" && key) extraFiles.push(toRelative(key));
  }
  return { actions, extraFiles };
}

/**
 * Nama dari `names` yang dipanggil di `text`, urut berdasarkan kemunculan pertama.
 *
 * @param {string} text
 * @param {string[]} names
 */
export function findCalls(text, names) {
  const clean = stripComments(text);
  const hits = [];
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(?<![\\w.])${escaped}\\s*\\(`).exec(clean);
    if (match) hits.push({ name, index: match.index });
  }
  return hits.sort((a, b) => a.index - b.index).map((hit) => hit.name);
}

/**
 * @typedef {{ path: string, name: string, ext: string }} FileLike
 * @typedef {"actions" | "extra" | "data" | "settings"} FileCategory
 * @typedef {"active" | "passive" | "unlinked"} ActionState
 * @typedef {{ category: FileCategory, order: number, state?: ActionState, calledBy?: string[] }} FileLayout
 */

/**
 * Tentukan kategori, urutan, status action, dan daftar pemanggil tiap file.
 *
 * @param {FileLike[]} files
 * @param {{
 *   init: string | null, end: string | null,
 *   runActions: string[],
 *   listed: string[] | null,
 *   extraListed: Set<string>,
 * }} ctx `listed` = action di `.usr [Actions]` (null bila tak ada); `runActions` = action di Run Logic
 * @param {Map<string, string>} texts path → isi file `.c` di root
 * @returns {Map<string, FileLayout>}
 */
export function layoutFiles(files, ctx, texts) {
  const isRootC = (file) => file.ext === ".c" && !file.path.includes("/");
  const rootC = files.filter(isRootC);
  const known = new Set(rootC.map((file) => file.path));
  const extraListed = new Set([...ctx.extraListed].map((p) => p.toLowerCase()));

  const middle = (ctx.listed ?? rootC.map((file) => file.path).sort((a, b) => a.localeCompare(b))).filter(
    (p) => known.has(p) && p !== ctx.init && p !== ctx.end,
  );
  for (const action of ctx.runActions) {
    if (known.has(action) && !middle.includes(action) && action !== ctx.init && action !== ctx.end) middle.push(action);
  }
  const unlinked = rootC
    .map((file) => file.path)
    .filter((p) => !middle.includes(p) && p !== ctx.init && p !== ctx.end)
    .sort((a, b) => a.localeCompare(b));

  const actionOrder = [...(ctx.init && known.has(ctx.init) ? [ctx.init] : []), ...middle, ...(ctx.end && known.has(ctx.end) ? [ctx.end] : []), ...unlinked];
  const activeSet = new Set([ctx.init, ctx.end, ...ctx.runActions]);
  const unlinkedSet = new Set(unlinked);

  const callers = new Map(actionOrder.map((p) => [p, []]));
  for (const caller of actionOrder) {
    const text = texts.get(caller);
    if (!text) continue;
    const others = actionOrder.filter((p) => p !== caller);
    const byName = new Map(others.map((p) => [baseName(p), p]));
    for (const name of findCalls(text, [...byName.keys()])) callers.get(byName.get(name))?.push(caller);
  }

  /** @type {Map<string, FileLayout>} */
  const layout = new Map();
  actionOrder.forEach((filePath, order) => {
    const state = unlinkedSet.has(filePath) ? "unlinked" : activeSet.has(filePath) ? "active" : "passive";
    layout.set(filePath, { category: "actions", order, state, calledBy: callers.get(filePath) });
  });

  for (const file of files) {
    if (layout.has(file.path)) continue;
    layout.set(file.path, { category: categoryOf(file, extraListed), order: 0 });
  }
  return layout;
}

/** @param {FileLike} file @param {Set<string>} extraListed @returns {FileCategory} */
function categoryOf(file, extraListed) {
  if (extraListed.has(file.path.toLowerCase())) return "extra";
  if (file.ext === ".c" || file.ext === ".h" || file.ext === ".js") return "extra";
  if (file.ext === ".dat" || file.ext === ".prm") return "data";
  return "settings";
}
