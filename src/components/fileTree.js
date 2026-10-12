/**
 * File tree sederhana: daftar file script, dikelompokkan per folder.
 */

const ACTIVE_CLASS = "bg-[#243044] text-[#e6edf3]";
const IDLE_CLASS = "text-[#9aa7b8] hover:bg-[#1b212b]";

/**
 * @param {HTMLElement} root
 * @param {{ files: Array<{ path: string, name: string }> } | null} project
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

  /** @type {Map<string, Array<{ path: string, name: string }>>} */
  const groups = new Map();
  for (const file of project.files) {
    const slash = file.path.lastIndexOf("/");
    const dir = slash === -1 ? "." : file.path.slice(0, slash);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)?.push(file);
  }

  const sorted = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [dir, files] of sorted) {
    const heading = document.createElement("div");
    heading.className = "mt-2 mb-1 truncate font-mono text-[10px] uppercase tracking-[0.08em] text-[#5b6572]";
    heading.textContent = dir;
    heading.title = dir;
    root.append(heading);

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
