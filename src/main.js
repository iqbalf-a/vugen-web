/**
 * VuGen Web — F1 + F4: buka folder script, edit, Save, Run, Snapshot, Log.
 */

import {
  getHealth,
  openProject,
  readFile,
  saveFile,
  startRun,
  stopRun,
  getRun,
  getRunEvents,
} from "./api.js";
import { createEditor } from "./components/editor.js";
import { renderFileTree } from "./components/fileTree.js";
import { createToolbar } from "./components/runToolbar.js";
import { createStepList } from "./components/stepList.js";
import { callEndLine } from "./utils/callRange.js";
import { stepGroupOf } from "./utils/steps.js";
import { createSnapshotPanel } from "./components/snapshotPanel.js";
import { createParameterPanel } from "./components/parameterPanel.js";
import { createLogPanel } from "./components/logPanel.js";
import { initStore } from "./store.js";

const els = {
  scriptPath: document.querySelector("#scriptPath"),
  scriptPathHistory: document.querySelector("#scriptPathHistory"),
  openBtn: document.querySelector("#openBtn"),
  runBtn: document.querySelector("#runBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  status: document.querySelector("#status"),
  fileTree: document.querySelector("#fileTree"),
  tabBar: document.querySelector("#tabBar"),
  editor: document.querySelector("#editor"),
  stepList: document.querySelector("#stepList"),
  snapshotPanel: document.querySelector("#snapshotPanel"),
  parameterPanel: document.querySelector("#parameterPanel"),
  logPanel: document.querySelector("#logPanel"),
  panelTabBar: document.querySelector("#panelTabBar"),
  panelContainer: document.querySelector("#panelContainer"),
  iterationsInput: document.querySelector("#iterations"),
  continueOnErrorCheckbox: document.querySelector("#continueOnError"),
  iterationDelayInput: document.querySelector("#iterationDelay"),
  newUserEachIterationCheckbox: document.querySelector("#newUserEachIteration"),
  insecureTLSCheckbox: document.querySelector("#insecureTLS"),
  thinkTimeSelect: document.querySelector("#thinkTime"),
  runOptions: document.querySelector("#runOptionsControls"),
  toggleOptions: document.querySelector("#toggleOptions"),
};

if (Object.values(els).some((element) => element === null)) {
  throw new Error("Shell HTML tidak lengkap: ada elemen yang tidak ditemukan.");
}

/** @type {Map<string, { text: string, saved: string }>} */
const docs = new Map();

const store = initStore({
  /** @type {"checking" | "ok" | "warn" | "error"} */
  health: "checking",
  status: "Memeriksa API…",
  /** @type {any} */
  project: null,
  /** @type {string | null} */
  activePath: null,
  /** @type {string | null} */
  currentRunId: null,
  /** @type {Object | null} */
  currentRun: null,
  /** @type {Object | null} */
  selectedStep: null,
  /** Grup step terpilih di daftar step: nomor iterasi, "init", atau "end" (satu-satunya sumber kebenaran) */
  selectedIteration: 1,
  /** @type {boolean} */
  isRunning: false,
});

/** @type {EventSource | null} */
let eventSource = null;

const editor = createEditor(els.editor, { onChange: syncActiveDoc });

store.subscribe((state) => {
  els.status.textContent = state.status;
  els.status.dataset.state = state.health;
  els.runBtn.disabled = state.isRunning || !state.project;
  els.stopBtn.disabled = !state.isRunning;
});

// Global Ctrl/Cmd+S
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void saveActive();
  }
});

// Kursor/klik di mana pun pada area sebuah API di editor (dari `web_custom_request(` sampai `LAST);`)
// memilih step-nya dan menampilkan snapshot-nya, seperti di VuGen. Tanpa lompat balik ke editor.
editor.on("cursorActivity", () => {
  const state = store.get();
  const steps = state.currentRun?.steps;
  const file = state.activePath;
  if (!steps || !file) return;

  const line = editor.getCursor().line + 1; // 1-based
  const runLogic = state.project?.runLogic;

  // Kandidat: step di file ini & grup terpilih yang barisnya paling dekat di atas (atau sama dengan) kursor
  let candidate = null;
  for (const step of steps) {
    if (step.file !== file || step.line > line || stepGroupOf(step, runLogic) !== state.selectedIteration) continue;
    if (!candidate || step.line > candidate.line) candidate = step;
  }
  if (!candidate || line > callEndLine(editor.getValue(), candidate.line)) return; // kursor di luar area API mana pun

  if (candidate.seq !== state.selectedStep?.seq) {
    store.set({ selectedStep: candidate });
    switchPanel("snapshot");
  }
});

/** Klik step di daftar -> buka file-nya di editor dan lompat ke barisnya */
async function revealStep(step) {
  const project = store.get().project;
  if (!project || !project.files.some((file) => file.path === step.file)) return;
  await openDoc(step.file);
  editor.focusLine(step.line);
}

createToolbar({
  input: els.scriptPath,
  datalist: els.scriptPathHistory,
  openButton: els.openBtn,
  runButton: els.runBtn,
  stopButton: els.stopBtn,
  onOpen: (path) => void openProjectPath(path),
  onRun: (options) => void startRunFlow(options),
  onStop: () => void stopRunFlow(),
  getIterations: () => parseInt(els.iterationsInput.value, 10) || 1,
  getContinueOnError: () => els.continueOnErrorCheckbox.checked,
  getIterationDelay: () => parseInt(els.iterationDelayInput.value, 10) || 0,
  getNewUserEachIteration: () => els.newUserEachIterationCheckbox.checked,
  getInsecureTLS: () => els.insecureTLSCheckbox.checked,
  getThinkTime: () => els.thinkTimeSelect.value,
});

// Panel tabs
const panelTabs = [
  { id: "snapshot", label: "Snapshot", el: els.snapshotPanel },
  { id: "parameter", label: "Parameter", el: els.parameterPanel },
  { id: "log", label: "Log", el: els.logPanel },
];
let activePanelId = "snapshot";

function renderPanelTabs() {
  if (!els.panelTabBar) return;
  els.panelTabBar.innerHTML = panelTabs.map(tab => `
    <button type="button" class="ui-tab" role="tab" aria-selected="${tab.id === activePanelId}" data-panel="${tab.id}">${tab.label}</button>
  `).join("");

  els.panelTabBar.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => switchPanel(btn.dataset.panel));
  });
}

function switchPanel(panelId) {
  activePanelId = panelId;
  panelTabs.forEach(tab => {
    if (tab.el) {
      tab.el.classList.toggle("hidden", tab.id !== panelId);
      tab.el.classList.toggle("block", tab.id === panelId);
    }
  });
  renderPanelTabs();
}

// Toggle run options - show by default so users see Insecure TLS option
let optionsVisible = true;
els.runOptions.classList.remove("hidden"); // Show initially
els.toggleOptions?.addEventListener("click", () => {
  optionsVisible = !optionsVisible;
  els.runOptions.classList.toggle("hidden", !optionsVisible);
  els.toggleOptions.textContent = optionsVisible ? "▲ Sembunyikan opsi" : "▼ Tampilkan opsi";
});

renderFileTree(els.fileTree, null, { activePath: null, onOpenFile: openDoc });
renderTabs();
renderPanelTabs();

// Initialize panels
createStepList(els.stepList, { onSelect: (step) => void revealStep(step) });
createSnapshotPanel(els.snapshotPanel);
createParameterPanel(els.parameterPanel);
createLogPanel(els.logPanel);

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

/** Start run flow with SSE */
async function startRunFlow(options) {
  const { project, activePath } = store.get();
  if (!project) return;

  // Save active doc first
  if (activePath) {
    const doc = docs.get(activePath);
    if (doc && editor.getValue() !== doc.saved) {
      try {
        await saveFile({ path: project.path, file: activePath, text: editor.getValue() });
        doc.saved = editor.getValue();
      } catch (error) {
        store.set({ health: "error", status: `Simpan gagal sebelum run: ${messageOf(error)}` });
        return;
      }
    }
  }

  try {
    store.set({ isRunning: true, status: "Memulai run…" });

    const { runId } = await startRun(project.path, options);
    store.set({
      currentRunId: runId,
      currentRun: { runId, scriptPath: project.path, options: { iterations: options.iterations }, steps: [], transactions: [], log: [] },
      selectedStep: null,
      selectedIteration: 1,
    });

    // Connect SSE
    eventSource = await getRunEvents(runId, project.path, (event) => handleRunEvent(event, runId, project.path));
  } catch (error) {
    store.set({ isRunning: false, health: "error", status: `Gagal memulai run: ${messageOf(error)}` });
  }
}

/** Handle SSE events */
function handleRunEvent(event, runId, scriptPath) {
  const { type, data, ts } = event;
  const state = store.get();

  switch (type) {
    case "started":
      store.set({ status: `Run dimulai: ${runId}` });
      break;

    case "iterationStart":
      store.set({ status: `Iterasi ${data.iteration} ${data.action}…` });
      break;

    case "iterationEnd":
      store.set({ status: `Iterasi ${data.iteration} ${data.action} ${data.status}` });
      break;

    case "step": {
      const steps = state.currentRun?.steps ? [...state.currentRun.steps, data] : [data];
      store.set({
        currentRun: { ...state.currentRun, steps, scriptPath, runId },
        status: `Step ${data.seq}: ${data.type} ${data.name} → ${data.response?.status || "?"}`,
      });
      break;
    }

    case "log": {
      const logs = state.currentRun?.log ? [...state.currentRun.log] : [];
      logs.push({ ...data, ts: data.ts || ts });
      store.set({ currentRun: { ...state.currentRun, log: logs } });
      break;
    }

    case "transaction": {
      const transactions = state.currentRun?.transactions ? [...state.currentRun.transactions, data] : [data];
      store.set({ currentRun: { ...state.currentRun, transactions } });
      break;
    }

    case "done":
      store.set({ isRunning: false, health: data.status === "passed" ? "ok" : data.status === "failed" ? "error" : "warn", status: `Run selesai: ${data.status}` });
      // Fetch full run result (event done baru dikirim setelah run.json tersimpan)
      void fetchRunResult(runId, scriptPath);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      break;

    case "stopped":
      // Event "done" menyusul (setelah run.json tersimpan) dan menutup stream.
      store.set({ status: `Run dihentikan: ${data.reason}` });
      break;

    case "error":
      store.set({ health: "error", status: `Error: ${data.message}` });
      break;
  }
}

/** Fetch full run result after completion */
async function fetchRunResult(runId, scriptPath) {
  try {
    const run = await getRun(runId, scriptPath);
    store.set({ currentRun: { ...run, scriptPath } });
  } catch (error) {
    store.set({ health: "error", status: `Gagal ambil hasil run: ${messageOf(error)}` });
  }
}

/** Stop run */
async function stopRunFlow() {
  const { currentRunId, project } = store.get();
  if (!currentRunId || !project) return;

  try {
    await stopRun(currentRunId);
    // Stream SSE tetap terbuka: event "stopped" lalu "done" mengakhiri run dan memuat run.json.
    store.set({ status: "Menghentikan run…" });
  } catch (error) {
    store.set({ isRunning: false, health: "error", status: `Gagal stop: ${messageOf(error)}` });
    eventSource?.close();
    eventSource = null;
  }
}