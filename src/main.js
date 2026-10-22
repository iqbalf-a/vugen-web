/**
 * VuGen Web — F1 + F4: buka folder script, edit, Save, Run, Snapshot, Log.
 */

import {
  getHealth,
  openProject,
  readFile,
  saveFile,
  saveParameterSetting,
  startRun,
  stopRun,
  resumeRun,
  getRun,
  getRunEvents,
} from "./api.js";
import { createEditor } from "./components/editor.js";
import { renderFileTree } from "./components/fileTree.js";
import { createToolbar } from "./components/runToolbar.js";
import { createStepList } from "./components/stepList.js";
import { callEndLine, statementStartLine } from "./utils/callRange.js";
import { stepGroupOf } from "./utils/steps.js";
import { createSnapshotPanel } from "./components/snapshotPanel.js";
import { createParameterPanel } from "./components/parameterPanel.js";
import { createLogPanel } from "./components/logPanel.js";
import { createTransactionsPanel } from "./components/transactionsPanel.js";
import { createParamBar } from "./components/paramBar.js";
import { openParamModal } from "./components/paramModal.js";
import { createToolboxPanel } from "./components/toolboxPanel.js";
import { createRunSettings } from "./components/runSettings.js";
import { initStore } from "./store.js";
import { extractSymbols } from "./utils/vugenComplete.js";

const els = {
  scriptPath: document.querySelector("#scriptPath"),
  scriptPathHistory: document.querySelector("#scriptPathHistory"),
  openBtn: document.querySelector("#openBtn"),
  runBtn: document.querySelector("#runBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  resumeBtn: document.querySelector("#resumeBtn"),
  status: document.querySelector("#status"),
  fileTree: document.querySelector("#fileTree"),
  tabBar: document.querySelector("#tabBar"),
  paramBar: document.querySelector("#paramBar"),
  editor: document.querySelector("#editor"),
  stepList: document.querySelector("#stepList"),
  snapshotPanel: document.querySelector("#snapshotPanel"),
  parameterPanel: document.querySelector("#parameterPanel"),
  logPanel: document.querySelector("#logPanel"),
  transactionsPanel: document.querySelector("#transactionsPanel"),
  toolboxPanel: document.querySelector("#toolboxPanel"),
  panelTabBar: document.querySelector("#panelTabBar"),
  panelContainer: document.querySelector("#panelContainer"),
  iterationsInput: document.querySelector("#iterations"),
  continueOnErrorCheckbox: document.querySelector("#continueOnError"),
  iterationDelayInput: document.querySelector("#iterationDelay"),
  newUserEachIterationCheckbox: document.querySelector("#newUserEachIteration"),
  insecureTLSCheckbox: document.querySelector("#insecureTLS"),
  thinkTimeSelect: document.querySelector("#thinkTime"),
  runSettingsBtn: document.querySelector("#runSettingsBtn"),
  runSettingsPanel: document.querySelector("#runSettingsPanel"),
  runSettingsSummary: document.querySelector("#runSettingsSummary"),
  runSettingsLock: document.querySelector("#runSettingsLock"),
};

if (Object.values(els).some((element) => element === null)) {
  throw new Error("Shell HTML tidak lengkap: ada elemen yang tidak ditemukan.");
}

const runSettings = createRunSettings({
  button: els.runSettingsBtn,
  panel: els.runSettingsPanel,
  summary: els.runSettingsSummary,
  lockNote: els.runSettingsLock,
  fields: {
    iterations: els.iterationsInput,
    delay: els.iterationDelayInput,
    newUser: els.newUserEachIterationCheckbox,
    continueOnError: els.continueOnErrorCheckbox,
    insecureTLS: els.insecureTLSCheckbox,
    thinkTime: els.thinkTimeSelect,
  },
});

/** @type {Map<string, { text: string, saved: string }>} */
const docs = new Map();

const store = initStore({
  /** @type {"checking" | "ok" | "warn" | "error"} */
  health: "checking",
  status: "Checking API…",
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
  /** @type {boolean} */
  isPaused: false,
  /** Step yang sedang di-fetch (sebelum response tiba) — untuk animasi live */
  pendingStep: null,
  /** Live position from lineAt event — for non-HTTP line highlight */
  liveAt: null,
  /** Counter log entries — naik 1 tiap log baru; logPanel baca langsung dari currentRun.log */
  logCount: 0,
});

const renderParamBar = createParamBar(els.paramBar, { onChange: changeParameter });

/** @type {EventSource | null} */
let eventSource = null;

/** Word wrap state (persists across tab switches) */
let wordWrapEnabled = true;

/** Breakpoints per file path: Map<path, Set<lineNumber>> */
const breakpoints = new Map();

const editor = createEditor(els.editor, {
  onChange: syncActiveDoc,
  onBreakpointsChange(lines) {
    const path = store.get().activePath;
    if (!path) return;
    if (lines.size > 0) breakpoints.set(path, lines);
    else breakpoints.delete(path);
  },
});

let lastPendingSeq = null;
let lastLiveAt = null;

store.subscribe((state) => {
  els.status.textContent = state.status;
  els.status.dataset.state = state.health;
  els.runBtn.disabled = state.isRunning || !state.project;
  els.stopBtn.disabled = !state.isRunning;
  els.resumeBtn.disabled = !state.isPaused;
  editor.setRunning(state.isRunning);
  runSettings.setLocked(state.isRunning);
  renderParamBar(state);

  // Highlight pending line (HTTP step) or live position (non-HTTP line) in editor
  const pending = state.pendingStep;
  const live = state.liveAt;
  const pendingSeq = pending?.seq ?? null;
  const liveKey = live ? `${live.file}:${live.line}` : null;
  if (pendingSeq !== lastPendingSeq || liveKey !== lastLiveAt) {
    lastPendingSeq = pendingSeq;
    lastLiveAt = liveKey;
    if (pending && pending.file === state.activePath && pending.line) {
      editor.highlightPendingLine(pending.line);
    } else if (live && live.file === state.activePath && live.line) {
      editor.highlightPendingLine(live.line);
    } else {
      editor.highlightPendingLine(null);
    }
  }
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
  { id: "parameter", label: "Runtime Data", el: els.parameterPanel },
  { id: "log", label: "Log", el: els.logPanel },
  { id: "transactions", label: "Transactions", el: els.transactionsPanel },
  { id: "toolbox", label: "Toolbox", el: els.toolboxPanel },
];
let activePanelId = "snapshot";

function renderPanelTabs() {
  if (!els.panelTabBar) return;
  els.panelTabBar.innerHTML = panelTabs.map(tab => `
    <button type="button" class="ui-tab" role="tab" aria-selected="${tab.id === activePanelId}" data-panel="${tab.id}">${tab.label}</button>
  `).join("");

  els.panelTabBar.querySelectorAll("button[data-panel]").forEach(btn => {
    btn.addEventListener("click", () => switchPanel(btn.dataset.panel));
  });

  const paramsBtn = document.createElement("button");
  paramsBtn.type = "button";
  paramsBtn.title = "Manage parameters";
  paramsBtn.className = "ml-auto flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[#5b6572] hover:text-[#9aa7b8] transition-colors";
  paramsBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/><path fill-rule="evenodd" d="M8 0a1 1 0 0 1 .894.553l.998 1.996a6.02 6.02 0 0 1 1.223.709l2.14-.535a1 1 0 0 1 1.098.48l1 1.732a1 1 0 0 1-.17 1.196l-1.55 1.55a6.13 6.13 0 0 1 0 1.638l1.55 1.55a1 1 0 0 1 .17 1.196l-1 1.732a1 1 0 0 1-1.097.48l-2.141-.534a6.02 6.02 0 0 1-1.223.708l-.998 1.996A1 1 0 0 1 8 16a1 1 0 0 1-.894-.553l-.998-1.996a6.02 6.02 0 0 1-1.223-.709l-2.14.535a1 1 0 0 1-1.098-.48l-1-1.732a1 1 0 0 1 .17-1.196l1.55-1.55a6.13 6.13 0 0 1 0-1.638L.617 5.13a1 1 0 0 1-.17-1.196l1-1.732a1 1 0 0 1 1.097-.48l2.141.534a6.02 6.02 0 0 1 1.223-.708L6.894.553A1 1 0 0 1 8 0Z"/></svg> Parameters`;
  paramsBtn.addEventListener("click", () => {
    const project = store.get().project;
    if (!project) return;
    openParamModal(project.parameters, changeParameter);
  });
  els.panelTabBar.appendChild(paramsBtn);
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

renderFileTree(els.fileTree, null, { activePath: null, onOpenFile: openDoc });
renderTabs();
renderPanelTabs();

// Initialize panels
createStepList(els.stepList, { onSelect: (step) => void revealStep(step) });
createSnapshotPanel(els.snapshotPanel);
createParameterPanel(els.parameterPanel);
createLogPanel(els.logPanel);
createTransactionsPanel(els.transactionsPanel);
createToolboxPanel(els.toolboxPanel);

void checkHealth();

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

async function checkHealth() {
  try {
    const { ok } = await getHealth();
    store.set(
      ok
        ? { health: "ok", status: "API ready. Enter a script folder path and click Open Folder." }
        : { health: "warn", status: "API returned an unexpected response" },
    );
  } catch (error) {
    store.set({ health: "error", status: `API not ready: ${messageOf(error)}` });
  }
}

/**
 * @param {string} path
 */
function refreshCompletions() {
  const project = store.get().project;
  const paramNames = project ? project.parameters.map((p) => p.name) : [];
  const varNames = extractSymbols([...docs.values()].map((d) => d.text));
  editor.setCompletions(paramNames, varNames);
}

async function openProjectPath(path) {
  store.set({ health: "checking", status: `Opening ${path}…` });

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
    refreshCompletions();
    renderFileTree(els.fileTree, project, { activePath: null, onOpenFile: openDoc });
    renderTabs();

    const first = project.actions[0]?.file ?? project.files.find((file) => file.ext === ".c")?.path;
    if (first) await openDoc(first);
  } catch (error) {
    store.set({ health: "error", status: `Failed to open folder: ${messageOf(error)}` });
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
      store.set({ health: "error", status: `Failed to open ${path}: ${messageOf(error)}` });
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
  editor.setBreakpoints(breakpoints.get(path) ?? new Set());
  refreshCompletions();
  editor.focus();
  renderTabs();
  renderFileTree(els.fileTree, store.get().project, { activePath: path, onOpenFile: openDoc });

  // Re-apply or clear pending/live highlight for the newly active file
  const { pendingStep: pending, liveAt: live } = store.get();
  if (pending && pending.file === path && pending.line) {
    editor.highlightPendingLine(pending.line);
  } else if (live && live.file === path && live.line) {
    editor.highlightPendingLine(live.line);
  } else {
    editor.highlightPendingLine(null);
  }
}

/** Simpan pengaturan parameter ke .prm lalu muat ulang project (nilai terbaru dibaca dari disk). */
async function changeParameter(name, changes) {
  const { project } = store.get();
  if (!project) return;
  try {
    await saveParameterSetting({ path: project.path, name, changes });
    const fresh = await openProject(project.path);
    store.set({ project: fresh, health: "ok", status: `Saved settings for {${name}}` });
  } catch (error) {
    store.set({ health: "error", status: `Failed to update {${name}}: ${messageOf(error)}` });
    throw error;
  }
}

async function saveActive() {
  const { project, activePath } = store.get();
  const doc = activePath ? docs.get(activePath) : null;
  if (!project || !activePath || !doc) return;

  const text = editor.getValue();
  if (text === doc.saved) {
    store.set({ status: `No changes in ${activePath}.` });
    return;
  }

  try {
    const result = await saveFile({ path: project.path, file: activePath, text });
    doc.text = text;
    doc.saved = text;
    store.set({
      health: "ok",
      status: `Saved: ${result.path} · ${result.size} bytes · ${String(result.eol).toUpperCase()} · ${result.encoding}`,
    });
    renderTabs();
  } catch (error) {
    store.set({ health: "error", status: `Failed to save ${activePath}: ${messageOf(error)}` });
  }
}

function renderTabs() {
  const activePath = store.get().activePath;
  const tabItems = [...docs.entries()].map(([path, doc]) => {
    const active = path === activePath;
    const item = document.createElement("div");
    item.className = `flex items-center rounded-[3px] font-mono text-[11.5px] ${
      active ? "bg-[#243044] text-[#e6edf3]" : "text-[#9aa7b8] hover:bg-[#1b212b]"
    }`;

    const label = document.createElement("button");
    label.type = "button";
    label.className = "flex items-center gap-1.5 px-2.5 py-1 max-w-[160px] truncate";
    label.title = path;
    label.dataset.path = path;

    const labelText = document.createElement("span");
    labelText.className = "truncate";
    labelText.textContent = path.split("/").pop() ?? path;
    label.append(labelText);

    if (doc.text !== doc.saved) {
      const dot = document.createElement("span");
      dot.className = "text-[#d2a24c] shrink-0";
      dot.textContent = "●";
      dot.title = "Unsaved";
      label.append(dot);
    }

    label.addEventListener("click", () => activateDoc(path));

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "flex items-center justify-center w-5 h-5 mr-0.5 rounded text-[#5b6572] hover:text-[#e6edf3] hover:bg-[#1b212b]";
    closeBtn.title = "Close tab";
    closeBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    closeBtn.addEventListener("click", (e) => { e.stopPropagation(); closeDoc(path); });

    item.append(label, closeBtn);
    return item;
  });

  // Container kiri: tabs scrollable
  const tabsArea = document.createElement("div");
  tabsArea.className = "flex min-w-0 flex-1 items-center gap-1 overflow-x-auto";
  tabsArea.append(...tabItems);

  // Container kanan: action buttons — selalu terlihat
  const actionsArea = document.createElement("div");
  actionsArea.className = "flex shrink-0 items-center border-l border-[#232a33] pl-1";

  const wrapBtn = document.createElement("button");
  wrapBtn.type = "button";
  wrapBtn.title = wordWrapEnabled ? "Disable word wrap" : "Enable word wrap";
  wrapBtn.className = `flex items-center gap-1 rounded px-2 py-1 text-[11px] font-sans transition-colors ${
    wordWrapEnabled ? "text-[#d2a24c] bg-[#1b212b]" : "text-[#5b6572] hover:text-[#9aa7b8]"
  }`;
  wrapBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 4h12M2 8h8a2 2 0 0 1 0 4H8m2 0-2 2m2-2-2-2"/></svg><span>Wrap</span>`;
  wrapBtn.addEventListener("click", () => {
    wordWrapEnabled = !wordWrapEnabled;
    editor.setWordWrap(wordWrapEnabled);
    renderTabs();
  });

  const beautifyBtn = document.createElement("button");
  beautifyBtn.type = "button";
  beautifyBtn.title = "Beautify (reformat indentation)";
  beautifyBtn.className = "flex items-center gap-1 rounded px-2 py-1 text-[11px] font-sans text-[#5b6572] hover:text-[#9aa7b8] transition-colors";
  beautifyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h3M7 4h7M2 8h7M11 8h3M2 12h5M9 12h5"/></svg><span>Beautify</span>`;
  beautifyBtn.addEventListener("click", () => {
    editor.beautify();
    syncActiveDoc();
  });

  // Menu ⋯ — Close All / Close All But This
  const menuBtn = document.createElement("button");
  menuBtn.type = "button";
  menuBtn.title = "Tab actions";
  menuBtn.className = "flex items-center justify-center w-6 h-6 rounded text-[#5b6572] hover:text-[#9aa7b8] hover:bg-[#1b212b] shrink-0";
  menuBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="2.5" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="8" cy="13.5" r="1.3"/></svg>`;
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelector("#tabMenu")?.remove();
    const activePath = store.get().activePath;
    const menu = document.createElement("div");
    menu.id = "tabMenu";
    menu.className = "absolute z-50 min-w-[160px] rounded-[4px] border border-[#2a3644] bg-[#141922] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)] text-[12px]";
    const rect = menuBtn.getBoundingClientRect();
    menu.style.cssText = `top:${rect.bottom + 4}px;right:${document.documentElement.clientWidth - rect.right}px;position:fixed`;
    const item = (label, disabled, fn) => {
      const el = document.createElement("button");
      el.type = "button";
      el.textContent = label;
      el.disabled = disabled;
      el.className = "w-full text-left px-3 py-1.5 hover:bg-[#1b212b] text-[#e6edf3] disabled:opacity-40 disabled:cursor-not-allowed";
      if (!disabled) el.addEventListener("click", () => { menu.remove(); fn(); });
      return el;
    };
    menu.append(
      item("Close All", docs.size === 0, closeAllDocs),
      item("Close All But This", !activePath || docs.size <= 1, () => closeAllButDoc(activePath)),
    );
    document.body.append(menu);
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("click", close, true); } };
    document.addEventListener("click", close, true);
  });

  actionsArea.append(wrapBtn, beautifyBtn, menuBtn);
  els.tabBar.replaceChildren(tabsArea, actionsArea);
}

/** Tutup tab. Konfirmasi bila ada perubahan yang belum disimpan. */
function closeDoc(path) {
  const doc = docs.get(path);
  if (!doc) return;
  if (doc.text !== doc.saved) {
    if (!confirm(`"${path.split("/").pop()}" has unsaved changes. Close without saving?`)) return;
  }
  docs.delete(path);
  const remaining = [...docs.keys()];
  const next = remaining[remaining.length - 1] ?? null;
  if (next) {
    activateDoc(next);
  } else {
    store.set({ activePath: null });
    editor.setDoc("");
    renderTabs();
  }
}

/** Tutup semua tab (konfirmasi jika ada yang belum disimpan). */
function closeAllDocs() {
  const unsaved = [...docs.entries()].filter(([, d]) => d.text !== d.saved).map(([p]) => p.split("/").pop());
  if (unsaved.length > 0 && !confirm(`${unsaved.length} file(s) have unsaved changes:\n${unsaved.join(", ")}\n\nClose all without saving?`)) return;
  docs.clear();
  store.set({ activePath: null });
  editor.setDoc("");
  renderTabs();
}

/** Tutup semua tab kecuali `keepPath`. */
function closeAllButDoc(keepPath) {
  const unsaved = [...docs.entries()].filter(([p, d]) => p !== keepPath && d.text !== d.saved).map(([p]) => p.split("/").pop());
  if (unsaved.length > 0 && !confirm(`${unsaved.length} file(s) have unsaved changes:\n${unsaved.join(", ")}\n\nClose without saving?`)) return;
  for (const path of [...docs.keys()]) {
    if (path !== keepPath) docs.delete(path);
  }
  activateDoc(keepPath);
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
        store.set({ health: "error", status: `Save failed before run: ${messageOf(error)}` });
        return;
      }
    }
  }

  try {
    followedFile = null;
    store.set({ isRunning: true, liveAt: null, pendingStep: null, isPaused: false, status: "Starting run…" });

    const bpList = [];
    for (const [file, lines] of breakpoints) {
      const text = docs.get(file)?.text;
      for (const line of lines) bpList.push({ file, line: text ? statementStartLine(text, line) : line });
    }
    options.breakpoints = bpList;

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
    store.set({ isRunning: false, health: "error", status: `Failed to start run: ${messageOf(error)}` });
  }
}

let followedFile = null;
let followChain = Promise.resolve();

/** Buka tab file tempat eksekusi berada (mis. fungsi di file lain) saat run pindah file. */
function followLiveFile(file) {
  if (!file || file === followedFile) return;
  followedFile = file;
  const { project, activePath } = store.get();
  if (file === activePath || !project?.files.some((f) => f.path === file)) return;
  followChain = followChain.then(() => openDoc(file));
}

/** Handle SSE events */
function handleRunEvent(event, runId, scriptPath) {
  const { type, data, ts } = event;
  const state = store.get();

  switch (type) {
    case "started":
      store.set({ status: `Run started: ${runId}` });
      break;

    case "iterationStart":
      store.set({ status: `Iteration ${data.iteration} ${data.action}…` });
      break;

    case "iterationEnd":
      store.set({ status: `Iteration ${data.iteration} ${data.action} ${data.status}` });
      break;

    case "stepPending":
      store.set({ pendingStep: data });
      break;

    case "lineAt":
      store.set({ liveAt: data });
      followLiveFile(data.file);
      break;

    case "step": {
      const steps = state.currentRun?.steps ? [...state.currentRun.steps, data] : [data];
      store.set({
        currentRun: { ...state.currentRun, steps, scriptPath, runId },
        pendingStep: null,
        isPaused: false,
        status: `Step ${data.seq}: ${data.type} ${data.name} → ${data.response?.status || "?"}`,
      });
      break;
    }

    case "log": {
      // Mutate log array langsung (hindari O(n²) spread); sinyal murah via logCount
      if (state.currentRun) {
        (state.currentRun.log ??= []).push({ ...data, ts: data.ts || ts });
        store.set({ logCount: state.currentRun.log.length });
      }
      break;
    }

    case "transaction": {
      const transactions = state.currentRun?.transactions ? [...state.currentRun.transactions, data] : [data];
      store.set({ currentRun: { ...state.currentRun, transactions } });
      break;
    }

    case "paused":
      store.set({ isPaused: true, status: `Paused at ${data.file}:${data.line}` });
      if (data.file) void openDoc(data.file).then(() => {
        if (data.line) editor.highlightPendingLine(data.line);
      });
      break;

    case "done":
      store.set({ isRunning: false, isPaused: false, pendingStep: null, liveAt: null, health: data.status === "passed" ? "ok" : data.status === "failed" ? "error" : "warn", status: `Run complete: ${data.status}` });
      // Tutup SSE dulu, baru fetch run.json — hindari race di beberapa browser
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      void fetchRunResult(runId, scriptPath);
      break;

    case "stopped":
      // Event "done" menyusul (setelah run.json tersimpan) dan menutup stream.
      store.set({ liveAt: null, isPaused: false, status: `Run stopped: ${data.reason}` });
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
    store.set({ health: "error", status: `Failed to fetch run result: ${messageOf(error)}` });
  }
}

els.resumeBtn.addEventListener("click", () => void resumeRunFlow());

async function resumeRunFlow() {
  const { currentRunId } = store.get();
  if (!currentRunId) return;
  try {
    await resumeRun(currentRunId);
    store.set({ isPaused: false, status: "Resuming…" });
  } catch (error) {
    store.set({ health: "error", status: `Failed to resume: ${messageOf(error)}` });
  }
}

/** Stop run */
async function stopRunFlow() {
  const { currentRunId, project } = store.get();
  if (!currentRunId || !project) return;

  try {
    await stopRun(currentRunId);
    // Stream SSE tetap terbuka: event "stopped" lalu "done" mengakhiri run dan memuat run.json.
    store.set({ status: "Stopping run…" });
  } catch (error) {
    store.set({ isRunning: false, health: "error", status: `Failed to stop run: ${messageOf(error)}` });
    eventSource?.close();
    eventSource = null;
  }
}