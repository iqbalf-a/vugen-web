/**
 * VuGen Web — wiring F1: buka folder script, telusuri file, edit, Save.
 *
 * Tab multi-file dikelola di sini lewat peta `docs` (path → teks). Editor
 * CodeMirror hanya menampilkan dokumen aktif.
 */

import { getHealth, openProject, readFile, saveFile } from "./api.js";
import { createEditor } from "./components/editor.js";
import { renderFileTree } from "./components/fileTree.js";
import { createToolbar } from "./components/runToolbar.js";
import { createStore } from "./store.js";

const els = {
  scriptPath: document.querySelector("#scriptPath"),
  scriptPathHistory: document.querySelector("#scriptPathHistory"),
  openBtn: document.querySelector("#openBtn"),
  status: document.querySelector("#status"),
  fileTree: document.querySelector("#fileTree"),
  tabBar: document.querySelector("#tabBar"),
  editor: document.querySelector("#editor"),
};

if (Object.values(els).some((element) => element === null)) {
  throw new Error("Shell HTML tidak lengkap: ada elemen yang tidak ditemukan.");
}

/** @type {Map<string, { text: string, saved: string }>} */
const docs = new Map();

const store = createStore({
  /** @type {"checking" | "ok" | "warn" | "error"} */
  health: "checking",
  status: "Memeriksa API…",
  /** @type {any} */
  project: null,
  /** @type {string | null} */
  activePath: null,
});

const editor = createEditor(els.editor, { onChange: syncActiveDoc });

store.subscribe((state) => {
  els.status.textContent = state.status;
  els.status.dataset.state = state.health;
});

// Satu jalur simpan: Ctrl/Cmd+S global (editor tidak memasang binding sendiri).
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void saveActive();
  }
});

createToolbar({
  input: els.scriptPath,
  datalist: els.scriptPathHistory,
  openButton: els.openBtn,
  onOpen: (path) => void openProjectPath(path),
});

renderFileTree(els.fileTree, null, { activePath: null, onOpenFile: openDoc });
renderTabs();
void checkHealth();

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

async function checkHealth() {
  try {
    const { ok } = await getHealth();
    store.set(
      ok
        ? { health: "ok", status: "API siap. Isi folder script lalu tekan Buka Folder." }
        : { health: "warn", status: "API merespons tidak dikenal" },
    );
  } catch (error) {
    store.set({ health: "error", status: `API tidak siap: ${messageOf(error)}` });
  }
}

/**
 * @param {string} path
 */
async function openProjectPath(path) {
  store.set({ health: "checking", status: `Membuka ${path}…` });

  try {
    const project = await openProject(path);
    docs.clear();
    store.set({
      project,
      activePath: null,
      health: project.warnings.length > 0 ? "warn" : "ok",
      status: `${project.files.length} file · Run Logic: ${project.runLogic.source}${
        project.warnings.length > 0 ? ` · ${project.warnings.length} warning` : ""
      }`,
    });

    editor.setDoc("");
    renderFileTree(els.fileTree, project, { activePath: null, onOpenFile: openDoc });
    renderTabs();

    if (project.warnings.length > 0) {
      console.warn("[vugen-web] warning project:", ...project.warnings);
    }

    const first = project.actions[0]?.file ?? project.files.find((file) => file.ext === ".c")?.path;
    if (first) await openDoc(first);
  } catch (error) {
    store.set({ health: "error", status: `Gagal membuka folder: ${messageOf(error)}` });
  }
}

/**
 * @param {string} path
 */
async function openDoc(path) {
  const project = store.get().project;
  if (!project) return;

  if (!docs.has(path)) {
    try {
      const file = await readFile(project.path, path);
      docs.set(path, { text: file.text, saved: file.text });
    } catch (error) {
      store.set({ health: "error", status: `Gagal membuka ${path}: ${messageOf(error)}` });
      return;
    }
  }

  activateDoc(path);
}

/**
 * @param {string} path
 */
function activateDoc(path) {
  const doc = docs.get(path);
  if (!doc) return;

  store.set({ activePath: path });
  editor.setDoc(doc.text);
  editor.focus();
  renderTabs();
  renderFileTree(els.fileTree, store.get().project, { activePath: path, onOpenFile: openDoc });
}

async function saveActive() {
  const { project, activePath } = store.get();
  const doc = activePath ? docs.get(activePath) : null;
  if (!project || !activePath || !doc) return;

  const text = editor.getValue();
  if (text === doc.saved) {
    store.set({ status: `Tidak ada perubahan pada ${activePath}.` });
    return;
  }

  try {
    const result = await saveFile({ path: project.path, file: activePath, text });
    doc.text = text;
    doc.saved = text;
    store.set({
      health: "ok",
      status: `Tersimpan: ${result.path} · ${result.size} byte · ${String(result.eol).toUpperCase()} · ${result.encoding}`,
    });
    renderTabs();
  } catch (error) {
    store.set({ health: "error", status: `Gagal menyimpan ${activePath}: ${messageOf(error)}` });
  }
}

function renderTabs() {
  const activePath = store.get().activePath;
  const tabs = [...docs.entries()].map(([path, doc]) => {
    const active = path === activePath;
    const item = document.createElement("button");
    item.type = "button";
    item.className = `flex items-center gap-1.5 rounded-[3px] px-2.5 py-1 font-mono text-[11.5px] ${
      active ? "bg-[#243044] text-[#e6edf3]" : "text-[#9aa7b8] hover:bg-[#1b212b]"
    }`;
    item.title = path;
    item.dataset.path = path;

    const label = document.createElement("span");
    label.className = "truncate";
    label.textContent = path.split("/").pop() ?? path;
    item.append(label);

    if (doc.text !== doc.saved) {
      const dot = document.createElement("span");
      dot.className = "text-[#d2a24c]";
      dot.textContent = "●";
      dot.title = "Belum disimpan";
      item.append(dot);
    }

    item.addEventListener("click", () => activateDoc(path));
    return item;
  });

  els.tabBar.replaceChildren(...tabs);
}

function syncActiveDoc() {
  const activePath = store.get().activePath;
  const doc = activePath ? docs.get(activePath) : null;
  if (!doc) return;
  doc.text = editor.getValue();
  renderTabs();
}
