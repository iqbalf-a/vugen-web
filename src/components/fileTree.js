import { escapeHtml } from "../utils/html.js";

/**
 * File tree: daftar file script, dikelompokkan per kategori (Action Utama, Action General, Parameter, Config).
 */

const ACTIVE_CLASS = "bg-[#243044] text-[#e6edf3]";
const IDLE_CLASS = "text-[#9aa7b8] hover:bg-[#1b212b]";

/** @typedef {{ path: string, name: string, ext: string, kind: string, category: string }} FileItem */

/** @type {Record<string, { label: string, order: number }>} */
const CATEGORY_CONFIG = {
  "action-utama": { label: "Action Utama", order: 1 },
  "action-general": { label: "Action General", order: 2 },
  parameter: { label: "Parameter Files", order: 3 },
  config: { label: "Config & Others", order: 4 },
};

/**
 * @param {HTMLElement} root
 * @param {{ files: FileItem[] } | null} project
 * @param {{ activePath: string | null, onOpenFile: (path: string) => void }} options
 */
export function renderFileTree(root, project, { activePath, onOpenFile }) {
  root.replaceChildren();

  if (!project) {
    root.textContent = "Belum ada folder yang dibuka.";
    return;
  }
  if (project.files.length === 0) {
    root.textContent = "Tidak ada file .c / .h / config di folder ini.";
    return;
  }

  /** @type {Map<string, FileItem[]>} */
  const groups = new Map();
  for (const file of project.files) {
    const cat = file.category || "config";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)?.push(file);
  }

  // Sort categories by order
  const sortedCats = [...groups.entries()].sort((a, b) => {
    const orderA = CATEGORY_CONFIG[a[0]]?.order ?? 99;
    const orderB = CATEGORY_CONFIG[b[0]]?.order ?? 99;
    return orderA - orderB;
  });

  for (const [cat, files] of sortedCats) {
    const config = CATEGORY_CONFIG[cat] || { label: cat, order: 99 };

    const heading = document.createElement("div");
    heading.className = "mb-1 mt-3 flex items-center gap-2 first:mt-0";
    heading.innerHTML = `
      <span class="shrink-0 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.08em] text-[#5b6572]">${escapeHtml(config.label)}</span>
      <span class="h-px min-w-0 flex-1 bg-[#2a3644]"></span>
    `;
    root.append(heading);

    // Sort files within category: main action first, then alphabetical
    files.sort((a, b) => {
      if (cat === "action-utama" || cat === "action-general") {
        // Put vuser_init/vuser_end at end of action-general
        const aSpecial = a.name.toLowerCase() === "vuser_init.c" || a.name.toLowerCase() === "vuser_end.c";
        const bSpecial = b.name.toLowerCase() === "vuser_init.c" || b.name.toLowerCase() === "vuser_end.c";
        if (aSpecial && !bSpecial) return 1;
        if (!aSpecial && bSpecial) return -1;
      }
      return a.name.localeCompare(b.name);
    });

    for (const file of files) {
      const active = file.path === activePath;
      const item = document.createElement("button");
      item.type = "button";
      item.className = `block w-full truncate rounded-[3px] px-2 py-1 text-left font-mono text-[12px] ${
        active ? ACTIVE_CLASS : IDLE_CLASS
      }`;
      item.textContent = file.name;
      item.title = file.path;
      item.dataset.path = file.path;
      item.addEventListener("click", () => onOpenFile(file.path));
      root.append(item);
    }
  }
}