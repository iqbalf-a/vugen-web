import { escapeHtml } from "../utils/html.js";
import { fileTitle, groupFiles } from "../utils/fileGroups.js";

/**
 * File tree: file script dikelompokkan per peran (Actions, Extra Files, Data, Settings).
 * Grup bisa di-collapse; keadaan disimpan di localStorage.
 */

const ACTIVE_CLASS = "bg-[#243044] text-[#e6edf3]";
const IDLE_CLASS = "text-[#9aa7b8] hover:bg-[#1b212b]";
const STORAGE_KEY = "vugen.fileTree.collapsed";

// Aktif = amber penuh, pasif = biru baja penuh, unlinked = cincin abu-abu.
const STATE_ICON = {
  active: "bg-[#d2a24c]",
  passive: "bg-[#5b8db8]",
  unlinked: "border border-[#5b6572]",
};

/** @typedef {{ path: string, name: string, ext: string, category?: string, state?: string, calledBy?: string[] }} FileItem */

function loadCollapsed() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

const collapsed = loadCollapsed();

function saveCollapsed() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsed]));
  } catch {
    // Penyimpanan tidak tersedia: keadaan collapse hanya berlaku selama sesi.
  }
}

/**
 * @param {HTMLElement} root
 * @param {{ files: FileItem[] } | null} project
 * @param {{ activePath: string | null, onOpenFile: (path: string) => void }} options
 */
export function renderFileTree(root, project, options) {
  const { activePath, onOpenFile } = options;
  root.replaceChildren();

  if (!project) {
    root.textContent = "No folder opened.";
    return;
  }
  if (project.files.length === 0) {
    root.textContent = "No .c / .h / config files in this folder.";
    return;
  }

  for (const group of groupFiles(project.files)) {
    const isCollapsed = collapsed.has(group.id);

    const heading = document.createElement("button");
    heading.type = "button";
    heading.className = "mb-1 mt-3 flex w-full items-center gap-1.5 text-left first:mt-0";
    heading.setAttribute("aria-expanded", String(!isCollapsed));
    if (group.hint) heading.title = group.hint;
    heading.innerHTML = `
      <span class="w-2.5 shrink-0 text-[9px] text-[#5b6572]" aria-hidden="true">${isCollapsed ? "▸" : "▾"}</span>
      <span class="shrink-0 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.08em] text-[#7d8896]">${escapeHtml(group.label)}</span>
      <span class="ui-count">${group.files.length}</span>
      <span class="h-px min-w-0 flex-1 bg-[#2a3644]"></span>
    `;
    heading.addEventListener("click", () => {
      if (collapsed.has(group.id)) collapsed.delete(group.id);
      else collapsed.add(group.id);
      saveCollapsed();
      renderFileTree(root, project, options);
    });
    root.append(heading);

    if (isCollapsed) continue;

    for (const file of group.files) {
      const active = file.path === activePath;
      const dim = file.state === "unlinked" && !active ? " opacity-60" : "";
      const item = document.createElement("button");
      item.type = "button";
      item.className = `flex w-full items-center rounded-[3px] px-2 py-1 text-left font-mono text-[12px] ${
        active ? ACTIVE_CLASS : IDLE_CLASS
      }${dim}`;
      item.title = fileTitle(file);
      item.dataset.path = file.path;

      if (group.id === "actions") {
        const icon = document.createElement("span");
        icon.className = `mr-2 h-[7px] w-[7px] shrink-0 rounded-full ${STATE_ICON[file.state ?? "active"]}`;
        icon.setAttribute("aria-hidden", "true");
        item.append(icon);
      }
      const label = document.createElement("span");
      label.className = "min-w-0 truncate";
      label.textContent = file.name;
      item.append(label);

      item.addEventListener("click", () => onOpenFile(file.path));
      root.append(item);
    }
  }
}
